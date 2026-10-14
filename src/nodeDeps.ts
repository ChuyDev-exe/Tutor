import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { Course } from './types';
import { npmDepsHash } from './pure';
import { spawnArgs } from './runtimes';
import { safeName, studentRoot } from './studentFolder';
import { tutorState } from './state';

/**
 * Paquetes npm del curso (`dependencias.npm`), instalados UNA vez y compartidos:
 *   <globalStorage>/npm/<hash>/node_modules      → instalación real (una por conjunto de paquetes,
 *                                                  la reutilizan todos los cursos y workspaces que lo pidan)
 *   <carpeta del alumno>/node_modules             → enlace a la instalación
 *   <curso instalado>/node_modules                → enlace (para `pruebasComando`, que corre ahí)
 * Node busca `node_modules` subiendo carpetas, así que cada ejercicio (en `NN-capitulo/`) lo encuentra
 * sin tener su propio `node_modules`.
 */

const READY = '.tutor-listo';
const inFlight = new Map<string, Promise<string | undefined>>();

export const usesNode = (lenguaje?: string): boolean => lenguaje === 'javascript' || lenguaje === 'typescript';

function npmInstall(cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // --ignore-scripts: los paquetes vienen de un curso no confiable y no deben ejecutar código al instalarse
    const argv = ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'];
    let output = '';
    try {
      const { cmd, args, shell } = spawnArgs(argv);
      const child = spawn(cmd, args, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
      child.stdout.on('data', (d) => (output = (output + String(d)).slice(-4000)));
      child.stderr.on('data', (d) => (output = (output + String(d)).slice(-4000)));
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, output: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, output });
      });
    } catch (err) {
      resolve({ ok: false, output: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Instala el conjunto de paquetes en la caché compartida si aún no está. Devuelve su `node_modules`. */
async function ensureShared(context: vscode.ExtensionContext, course: Course, deps: Record<string, string>): Promise<string | undefined> {
  const hash = npmDepsHash(deps);
  const dir = path.join(context.globalStorageUri.fsPath, 'npm', hash);
  const modules = path.join(dir, 'node_modules');
  if (fs.existsSync(path.join(dir, READY))) return modules;

  const running = inFlight.get(hash);
  if (running) return running;
  const job = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `tutor-deps-${hash}`, private: true, dependencies: deps }, null, 2) + '\n');
    const names = Object.keys(deps).join(', ');
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Tutor: instalando los paquetes de «${course.titulo}» (${names}). Solo se hace una vez…` },
      () => npmInstall(dir)
    );
    if (!res.ok) {
      vscode.window.showErrorMessage(
        `Tutor: no se pudieron instalar los paquetes del curso. ¿Tienes Node.js y conexión a internet?\n${res.output.trim().split('\n').slice(-5).join('\n')}`
      );
      return undefined;
    }
    fs.writeFileSync(path.join(dir, READY), new Date().toISOString() + '\n');
    return modules;
  })().finally(() => inFlight.delete(hash));
  inFlight.set(hash, job);
  return job;
}

/**
 * Enlaza `<dir>/node_modules` a la instalación compartida. Un `node_modules` real del alumno
 * (lo instaló él) se respeta; un enlace viejo (el curso cambió de paquetes) se reemplaza.
 */
function link(dir: string, target: string): void {
  const at = path.join(dir, 'node_modules');
  let st: fs.Stats | undefined;
  try {
    st = fs.lstatSync(at);
  } catch {
    /* no existe */
  }
  if (st && !st.isSymbolicLink()) return;
  if (st) {
    try {
      if (path.resolve(dir, fs.readlinkSync(at)) === path.resolve(target)) return;
    } catch {
      /* enlace roto: se rehace */
    }
    fs.rmSync(at, { force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  // 'junction' en Windows no pide permisos de administrador; en macOS/Linux se ignora
  fs.symlinkSync(target, at, 'junction');
}

/**
 * Un `package.json` en la carpeta del alumno: si instala algo con `npm install` desde un ejercicio,
 * npm sube hasta aquí en vez de crear otro `node_modules` en la carpeta del ejercicio.
 */
function writeStudentPackage(dir: string, course: Course, deps: Record<string, string>): void {
  const file = path.join(dir, 'package.json');
  let pkg: Record<string, any> = { name: safeName(course.id), private: true };
  try {
    if (fs.existsSync(file)) pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return; // el alumno lo editó y no es JSON válido: no se toca
  }
  const merged = { ...(pkg.dependencies ?? {}), ...deps };
  if (JSON.stringify(merged) === JSON.stringify(pkg.dependencies)) return;
  fs.writeFileSync(file, JSON.stringify({ ...pkg, dependencies: merged }, null, 2) + '\n');
}

/**
 * Deja los paquetes del curso listos para sus ejercicios. Pide permiso la primera vez.
 * Devuelve false si el curso los necesita y no se pudieron preparar.
 */
export async function ensureNodeDeps(context: vscode.ExtensionContext, course: Course, ask = true): Promise<boolean> {
  const deps = course.npm;
  if (!deps) return true;
  const key = `npm:${npmDepsHash(deps)}`;
  const trusted = (tutorState.get().confiables ??= {});
  const allowed = trusted[course.id] ?? [];
  if (!allowed.includes(key)) {
    if (!ask) return false;
    const list = Object.entries(deps).map(([k, v]) => `• ${k} ${v}`).join('\n');
    const pick = await vscode.window.showWarningMessage(
      `El curso «${course.titulo}» usa estos paquetes de npm:`,
      {
        modal: true,
        detail: `${list}\n\nSe descargan una sola vez y los comparten todos los ejercicios (no se crea un node_modules por ejercicio). No se ejecutan scripts de instalación.`,
      },
      'Instalar'
    );
    if (pick !== 'Instalar') return false;
    trusted[course.id] = [...allowed, key];
    tutorState.save();
  }
  const modules = await ensureShared(context, course, deps);
  if (!modules) return false;
  try {
    const root = studentRoot(course);
    link(root, modules);
    writeStudentPackage(root, course, deps);
    link(course.root, modules);
  } catch (err) {
    vscode.window.showErrorMessage(`Tutor: no se pudo enlazar node_modules (${err instanceof Error ? err.message : err})`);
    return false;
  }
  return true;
}
