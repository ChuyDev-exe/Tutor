import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { COMPILE_TIMEOUT_MS, runtimeFor } from './runtimes';
import type { RunResult } from './runner';

const MAX_CAPTURE = 200_000;
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/** La terminal solo entiende \r\n como salto de línea. */
export const toTerminal = (s: string): string => s.replace(/\r?\n/g, '\r\n');

/**
 * Edición de línea mínima para la entrada del alumno (la pseudoterminal no hace eco):
 * devuelve lo que hay que pintar, las líneas completas a enviar al programa y el búfer pendiente.
 */
export function editLine(buffer: string, data: string): { echo: string; lines: string[]; buffer: string; interrupt: boolean; eof: boolean } {
  let echo = '';
  const lines: string[] = [];
  let interrupt = false;
  let eof = false;
  // flechas, Inicio/Fin…: no se editan, se ignoran
  data = data.replace(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]/g, '');
  for (const ch of Array.from(data)) {
    if (ch === '\r' || ch === '\n') {
      echo += '\r\n';
      lines.push(buffer);
      buffer = '';
    } else if (ch === '\x7f' || ch === '\b') {
      if (buffer) {
        buffer = Array.from(buffer).slice(0, -1).join('');
        echo += '\b \b';
      }
    } else if (ch === '\x03') {
      interrupt = true;
      echo += '^C\r\n';
      break;
    } else if (ch === '\x04') {
      eof = true;
      break;
    } else if (ch >= ' ') {
      buffer += ch;
      echo += ch;
    }
  }
  return { echo, lines, buffer, interrupt, eof };
}

/** Cabecera que fuerza stdout sin búfer en C/C++: sin ella, `printf("Nombre: ")` no se ve antes del `scanf`. */
function unbufferedHeader(): string {
  const file = path.join(os.tmpdir(), 'tutor-ide-unbuffered.h');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      '#include <stdio.h>\n__attribute__((constructor)) static void tutor_ide_unbuffered(void) { setvbuf(stdout, NULL, _IONBF, 0); }\n'
    );
  }
  return file;
}

let current: vscode.Terminal | undefined;

/**
 * Ejecuta el archivo del alumno en una terminal interactiva: lo que escribe llega al programa por stdin.
 * Compila antes si el lenguaje lo requiere. Captura stdout/stderr para el tutor. Ctrl+C lo detiene.
 */
export function runInTerminal(file: string, lenguaje: string | undefined, title: string): Promise<RunResult> {
  const rt = runtimeFor(lenguaje);
  if (!rt) {
    return Promise.resolve({ ok: false, stdout: '', stderr: '', exitCode: null, durationMs: 0, error: `Sin runtime embebido para "${lenguaje || 'desconocido'}".` });
  }
  current?.dispose();

  return new Promise<RunResult>((resolve) => {
    const writeEmitter = new vscode.EventEmitter<string>();
    const write = (s: string) => writeEmitter.fire(toTerminal(s));
    const cwd = path.dirname(file);
    const env = { ...process.env, PYTHONUNBUFFERED: '1' };
    let child: ChildProcess | undefined;
    let stdout = '';
    let stderr = '';
    let buffer = '';
    let start = Date.now();
    let settled = false;

    const finish = (r: Omit<RunResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      const ms = Date.now() - start;
      write(`\n${DIM}── ${r.ok ? 'Terminó sin errores' : r.error || `Terminó con código ${r.exitCode}`} · ${ms} ms ──${RESET}\n`);
      resolve({ ...r, durationMs: ms });
    };

    const launch = (cmd: string[], onClose: (code: number | null) => void) => {
      try {
        child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        finish({ ok: false, stdout, stderr, exitCode: null, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      child.stdout?.on('data', (d) => {
        const s = String(d);
        if (stdout.length < MAX_CAPTURE) stdout += s;
        write(s);
      });
      child.stderr?.on('data', (d) => {
        const s = String(d);
        if (stderr.length < MAX_CAPTURE) stderr += s;
        write(RED + s + RESET);
      });
      child.stdin?.on('error', () => {}); // EPIPE si el programa termina sin leer stdin
      child.on('error', (err) => finish({ ok: false, stdout, stderr, exitCode: null, error: err.message }));
      child.on('close', onClose);
    };

    const runProgram = () => {
      start = Date.now();
      launch(rt.cmd(file), (code) => finish({ ok: code === 0, stdout, stderr, exitCode: code, error: code === null ? 'Ejecución detenida' : undefined }));
    };

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        write(`${DIM}── Correr: ${title} · escribe aquí si el programa pide datos · Ctrl+C lo detiene ──${RESET}\n`);
        if (!rt.compile) return runProgram();
        write(`${DIM}Compilando…${RESET}\n`);
        const compileCmd = [...rt.compile(file), '-include', unbufferedHeader()];
        const timer = setTimeout(() => child?.kill('SIGKILL'), COMPILE_TIMEOUT_MS);
        launch(compileCmd, (code) => {
          clearTimeout(timer);
          if (code !== 0) return finish({ ok: false, stdout, stderr, exitCode: code, error: 'Error de compilación' });
          stdout = '';
          stderr = '';
          runProgram();
        });
      },
      close: () => {
        if (!settled) child?.kill('SIGKILL');
        writeEmitter.dispose();
      },
      handleInput: (data) => {
        if (settled || !child) return;
        const r = editLine(buffer, data);
        buffer = r.buffer;
        if (r.echo) writeEmitter.fire(r.echo);
        for (const line of r.lines) child.stdin?.write(line + '\n');
        if (r.interrupt) child.kill('SIGKILL');
        else if (r.eof) {
          if (buffer) child.stdin?.write(buffer);
          buffer = '';
          child.stdin?.end();
        }
      },
    };

    current = vscode.window.createTerminal({ name: 'Tutor: Correr', pty, iconPath: new vscode.ThemeIcon('play') });
    current.show(false);
  });
}
