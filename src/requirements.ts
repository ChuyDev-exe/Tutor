import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Course, Requirement } from './types';
import { readText } from './content';
import { analyzeScript, compareVersions, isSafeCommand, isSafeVersionArg } from './pure';
import { tutorState } from './state';
import { notify } from './a11y';

export interface RequirementStatus {
  req: Requirement;
  nombre: string;
  found: boolean;
  version?: string;
  versionOk: boolean;
  obligatorio: boolean;
  instalar?: string;
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    try {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
      child.stdout.on('data', (d) => (out += String(d)));
      child.stderr.on('data', (d) => (out += String(d)));
      child.on('error', () => (clearTimeout(timer), resolve({ ok: false, out })));
      child.on('close', (code) => (clearTimeout(timer), resolve({ ok: code === 0, out })));
    } catch {
      resolve({ ok: false, out });
    }
  });
}

export async function checkRequirements(course: Course): Promise<RequirementStatus[]> {
  const platform = process.platform as 'darwin' | 'linux' | 'win32';
  return Promise.all(
    course.requisitos.map(async (req) => {
      // el curso es contenido no confiable: nunca se ejecuta nada que no sea `<ejecutable> <bandera>`
      const arg = req.versionArg ?? '--version';
      const safe = isSafeCommand(req.comando) && isSafeVersionArg(arg);
      const res = safe ? await run(req.comando, [arg]) : { ok: false, out: '' };
      const version = res.out.match(/\d+(?:\.\d+)+/)?.[0];
      const versionOk = !req.versionMinima || (!!version && compareVersions(version, req.versionMinima) >= 0);
      return {
        req,
        nombre: req.nombre || req.comando,
        found: res.ok,
        version,
        versionOk,
        obligatorio: req.obligatorio !== false,
        instalar: req.instalar?.[platform],
      };
    })
  );
}

export const isBlocking = (s: RequirementStatus): boolean => s.obligatorio && (!s.found || !s.versionOk);

/** Texto Markdown con el resultado, para el panel de resultados. */
export function formatReport(course: Course, list: RequirementStatus[]): string {
  const lines = list.map((s) => {
    const icon = s.found && s.versionOk ? '✅' : s.obligatorio ? '❌' : '⚠️';
    const v = s.version ? ` ${s.version}` : '';
    const min = s.req.versionMinima ? ` (mínimo ${s.req.versionMinima})` : '';
    const state = !s.found ? 'no encontrado' : !s.versionOk ? `versión insuficiente${min}` : 'ok';
    const how = !(s.found && s.versionOk) && s.instalar ? `\n    Instalar: \`${s.instalar}\`` : '';
    return `- ${icon} **${s.nombre}**${v}${s.found && s.versionOk ? min : ''} — ${state}${how}`;
  });
  return `# Requisitos de «${course.titulo}»\n\n${lines.join('\n') || '_El curso no declara requisitos._'}`;
}

const warned = new Set<string>();

/**
 * Valida en silencio los requisitos del curso; si falta algo obligatorio avisa
 * una vez por sesión con acciones (detalles / manual / setup).
 */
export async function validateOnOpen(course: Course, force = false): Promise<RequirementStatus[]> {
  if (!course.requisitos.length) return [];
  const list = await checkRequirements(course);
  const missing = list.filter(isBlocking);
  if (missing.length && (force || !warned.has(course.id))) {
    warned.add(course.id);
    const actions = ['Ver detalles'];
    if (course.manualFile) actions.push('Abrir manual');
    if (course.setupFile) actions.push('Ejecutar setup');
    const pick = await vscode.window.showWarningMessage(
      `Tutor: faltan requisitos para «${course.titulo}»: ${missing.map((m) => m.nombre).join(', ')}.`,
      ...actions
    );
    if (pick === 'Ver detalles') void vscode.commands.executeCommand('tutor.checkRequirements', course.id);
    if (pick === 'Abrir manual') void vscode.commands.executeCommand('tutor.openManual', course.id);
    if (pick === 'Ejecutar setup') void vscode.commands.executeCommand('tutor.runSetup', course.id);
  } else if (!missing.length) {
    warned.delete(course.id);
  }
  return list;
}

/** Ejecuta setup.sh del curso en una terminal visible, tras mostrar qué hace y qué riesgos tiene. */
export async function runSetup(course: Course): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!course.setupFile || !fs.existsSync(course.setupFile)) {
    notify(`«${course.titulo}» no incluye script de setup.`);
    return;
  }
  if (!ws) {
    vscode.window.showErrorMessage('Tutor: abre una carpeta de workspace para ejecutar el setup.');
    return;
  }
  if (process.platform === 'win32') {
    vscode.window.showWarningMessage('El setup es un script .sh: ejecútalo desde WSL o Git Bash.');
    return;
  }

  const file = course.setupFile;
  const analysis = analyzeScript(fs.readFileSync(file, 'utf8'));
  const trusted = (tutorState.get().confiables ??= {});
  const key = `setup:${course.id}`;
  const risky = analysis.riesgos.filter((r) => r.nivel !== 'info');
  const critical = analysis.riesgos.some((r) => r.nivel === 'critico');

  // mismo script ya aprobado y sin operaciones delicadas: no se vuelve a preguntar
  const unchanged = (trusted[key] ?? []).includes(analysis.sha);
  if (!(unchanged && !risky.length)) {
    const shown = analysis.comandos.slice(0, 12).map((c) => `   • ${c}`).join('\n');
    const more = analysis.comandos.length > 12 ? `\n   … y ${analysis.comandos.length - 12} comando(s) más` : '';
    const icon = { critico: '✖', aviso: '⚠', info: 'ℹ' } as const;
    const riskText = analysis.riesgos.length
      ? analysis.riesgos.map((r) => `   ${icon[r.nivel]} Línea ${r.linea}: ${r.etiqueta}`).join('\n')
      : '   Ninguna operación de riesgo conocida (es una revisión automática, no una garantía).';
    const detail =
      `Origen del curso: ${course.source}\nArchivo: ${path.basename(file)} (${analysis.lineas} líneas)\n\n` +
      `Qué hace (comandos del script):\n${shown}${more}\n\nRevisión de riesgos:\n${riskText}\n\n` +
      'Se ejecuta en una terminal visible, con tu carpeta de trabajo como directorio actual. Puedes pararlo con Ctrl+C.';
    const runLabel = critical ? 'Ejecutar de todos modos' : 'Ejecutar';
    const pick = await vscode.window.showWarningMessage(
      critical
        ? `⚠ El setup de «${course.titulo}» contiene operaciones peligrosas`
        : `¿Ejecutar el setup de «${course.titulo}»?`,
      { modal: true, detail },
      runLabel,
      'Ver script'
    );
    if (pick === 'Ver script') {
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
      const again = await vscode.window.showInformationMessage(
        'Revisa el script. Cuando termines, ¿lo ejecutamos?',
        'Ejecutar ahora',
        'Cancelar'
      );
      if (again !== 'Ejecutar ahora') return;
    } else if (pick !== runLabel) {
      return;
    }
    if (!risky.length) {
      trusted[key] = [...(trusted[key] ?? []), analysis.sha].slice(-5);
      tutorState.save();
    }
  } else {
    notify(`Tutor: ejecutando el setup de «${course.titulo}» (script ya aprobado, sin cambios).`);
  }

  const term = vscode.window.createTerminal({
    name: `Setup: ${course.titulo}`,
    cwd: ws.uri.fsPath,
    env: { TUTOR_COURSE_DIR: course.root, TUTOR_WORKSPACE: ws.uri.fsPath },
  });
  term.show();
  term.sendText(`bash '${file.replace(/'/g, `'\\''`)}'`);
}

export async function openManual(course: Course): Promise<void> {
  if (!course.manualFile || !readText(course.manualFile)) {
    notify(`«${course.titulo}» no incluye manual de configuración.`);
    return;
  }
  const uri = vscode.Uri.file(course.manualFile);
  await vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, () =>
    vscode.window.showTextDocument(uri)
  );
}
