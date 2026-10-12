import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { Chapter, Course, Exercise } from './types';
import { ensureExerciseFile } from './studentFolder';
import { tutorState } from './state';

import { COMPILE_TIMEOUT_MS, RUNTIMES, Runtime, runtimeFor } from './runtimes';
export { runtimeFor };

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

export interface TestCaseSpec {
  nombre?: string;
  entrada?: string;
  esperado?: string;
  contiene?: string;
}

export interface TestCaseReport {
  nombre: string;
  ok: boolean;
  esperado: string;
  obtenido: string;
  stderr: string;
}

export interface TestReport {
  kind: 'cases' | 'command';
  total: number;
  passed: number;
  durationMs: number;
  cases?: TestCaseReport[];
  output?: string;
}

export function hasTests(ex: Exercise): boolean {
  return !!(ex.pruebas || ex.pruebasComando);
}

const MAX_OUTPUT = 200_000;
const cap = (s: string): string => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '\n…(salida truncada)' : s);

function exec(
  cmd: string[],
  opts: { cwd?: string; stdin?: string; timeoutMs: number }
): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: Omit<RunResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, durationMs: Date.now() - start });
    };
    try {
      const child = spawn(cmd[0], cmd.slice(1), { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({
          ok: false,
          stdout,
          stderr,
          exitCode: null,
          error: `Tiempo de ejecución agotado (${Math.round(opts.timeoutMs / 1000)}s)`,
        });
      }, opts.timeoutMs);
      child.stdout.on('data', (d) => (stdout = cap(stdout + String(d))));
      child.stderr.on('data', (d) => (stderr = cap(stderr + String(d))));
      child.on('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, stdout, stderr, exitCode: null, error: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish({ ok: code === 0, stdout, stderr, exitCode: code });
      });
      // EPIPE si el programa termina sin leer stdin: no debe tumbar el extension host
      child.stdin.on('error', () => {});
      if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
      child.stdin.end();
    } catch (err) {
      finish({ ok: false, stdout, stderr, exitCode: null, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Compila `file` si el lenguaje lo requiere. Devuelve un RunResult con el error si falla. */
export async function compileIfNeeded(rt: Runtime, file: string): Promise<RunResult | undefined> {
  if (!rt.compile) return undefined;
  const res = await exec(rt.compile(file), { cwd: path.dirname(file), timeoutMs: COMPILE_TIMEOUT_MS });
  if (res.ok) return undefined;
  return { ...res, error: res.error ? `No se pudo compilar: ${res.error}` : 'Error de compilación' };
}

/** Ejecuta el archivo de solución del estudiante. */
export async function runSolution(file: string, lenguaje?: string): Promise<RunResult> {
  const rt = runtimeFor(lenguaje);
  if (!rt) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      error: `Sin runtime embebido para "${lenguaje || 'desconocido'}". Lenguajes soportados: ${Object.keys(RUNTIMES).join(', ')}. Usa un ejercicio con "pruebasComando" para otros lenguajes.`,
    };
  }
  const compileError = await compileIfNeeded(rt, file);
  if (compileError) return compileError;
  return exec(rt.cmd(file), { cwd: path.dirname(file), timeoutMs: rt.timeoutMs });
}

function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

/** Ejecuta pruebas por casos (JSON) contra el archivo de solución. */
export async function runJsonTests(
  file: string,
  lenguaje: string | undefined,
  cases: TestCaseSpec[]
): Promise<TestReport> {
  const rt = runtimeFor(lenguaje);
  if (!rt) {
    return {
      kind: 'cases',
      total: cases.length,
      passed: 0,
      durationMs: 0,
      cases: [
        {
          nombre: 'runtime',
          ok: false,
          esperado: `runtime para ${lenguaje || '?'}`,
          obtenido: '',
          stderr: `Sin runtime embebido para "${lenguaje || '?'}".`,
        },
      ],
    };
  }
  const start = Date.now();
  const compileError = await compileIfNeeded(rt, file);
  if (compileError) {
    return {
      kind: 'cases',
      total: cases.length,
      passed: 0,
      durationMs: Date.now() - start,
      cases: [{ nombre: 'Compilación', ok: false, esperado: 'compilar sin errores', obtenido: '', stderr: compileError.stderr || compileError.error || '' }],
    };
  }
  const reports: TestCaseReport[] = [];
  let passed = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const res = await exec(rt.cmd(file), { cwd: path.dirname(file), stdin: c.entrada, timeoutMs: rt.timeoutMs });
    const obtenido = normalize(res.stdout);
    let ok: boolean;
    let esperado: string;
    if (c.contiene !== undefined) {
      esperado = `contiene: ${c.contiene}`;
      ok = res.ok && obtenido.includes(normalize(c.contiene));
    } else {
      esperado = c.esperado ?? '';
      ok = res.ok && obtenido === normalize(esperado);
    }
    if (ok) passed++;
    reports.push({
      nombre: c.nombre || `Caso ${i + 1}`,
      ok,
      esperado,
      obtenido: obtenido || '(sin salida)',
      stderr: res.stderr || res.error || '',
    });
  }
  return { kind: 'cases', total: cases.length, passed, durationMs: Date.now() - start, cases: reports };
}

/** Ejecuta un comando de pruebas personalizado (pytest, npm test, go test…). */
export async function runCustomTests(cwd: string, command: string): Promise<TestReport> {
  const start = Date.now();
  const shell = process.platform === 'win32' ? 'cmd' : 'sh';
  const flag = process.platform === 'win32' ? '/c' : '-c';
  const res = await exec([shell, flag, command], { cwd, timeoutMs: 60_000 });
  const output = [res.stdout, res.stderr, res.error || ''].filter(Boolean).join('\n');
  return {
    kind: 'command',
    total: 1,
    passed: res.ok ? 1 : 0,
    durationMs: Date.now() - start,
    output: output || '(sin salida)',
  };
}

export function loadTestCases(file: string): TestCaseSpec[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Orquesta pruebas de un ejercicio: casos JSON o comando personalizado. */
export async function runTestsFor(
  context: vscode.ExtensionContext,
  course: Course,
  chapter: Chapter,
  exercise: Exercise
): Promise<TestReport> {
  if (exercise.pruebasComando) {
    // el comando viene del curso (contenido no confiable): se pide permiso la primera vez
    const trusted = (tutorState.get().confiables ??= {});
    const allowed = trusted[course.id] ?? [];
    if (!allowed.includes(exercise.pruebasComando)) {
      const pick = await vscode.window.showWarningMessage(
        `El curso «${course.titulo}» quiere ejecutar este comando en tu máquina para probar tu código:\n\n${exercise.pruebasComando}\n\nSolo continúa si confías en el origen del curso.`,
        { modal: true },
        'Permitir'
      );
      if (pick !== 'Permitir') {
        return { kind: 'command', total: 0, passed: 0, durationMs: 0, output: 'Ejecución cancelada: no autorizaste el comando del curso.' };
      }
      trusted[course.id] = [...allowed, exercise.pruebasComando];
      tutorState.save();
    }
    return runCustomTests(course.root, exercise.pruebasComando);
  }
  if (exercise.pruebas) {
    const cases = loadTestCases(exercise.pruebas);
    if (!cases.length) {
      return { kind: 'cases', total: 0, passed: 0, durationMs: 0, cases: [], output: `Archivo de pruebas vacío o ilegible: ${exercise.pruebas}` };
    }
    const file = ensureExerciseFile(course, chapter, exercise);
    return runJsonTests(file, exercise.lenguaje, cases);
  }
  return { kind: 'command', total: 0, passed: 0, durationMs: 0, output: 'Este ejercicio no tiene pruebas definidas.' };
}
