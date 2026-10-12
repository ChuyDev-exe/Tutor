import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { dockerMode, ExecMode, LOCAL, Runtime, runtimeFor, toolFor } from './runtimes';
import { notify } from './a11y';

/** Lenguajes para los que el alumno eligió Docker (se recuerda entre sesiones). */
const DOCKER_KEY = 'tutor.dockerPorLenguaje';

/** Ejecuta `<cmd> <args>` y dice si terminó bien. Nunca lanza. */
function probe(cmd: string, args: string[], timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', shell: process.platform === 'win32' });
      const timer = setTimeout(() => (child.kill('SIGKILL'), resolve(false)), timeoutMs);
      child.on('error', () => (clearTimeout(timer), resolve(false)));
      child.on('close', (code) => (clearTimeout(timer), resolve(code === 0)));
    } catch {
      resolve(false);
    }
  });
}

/** Herramientas ya encontradas en esta sesión (las ausentes se vuelven a buscar: quizá se instalaron). */
const found = new Set<string>();

export async function hasTool(tool: string, versionArg = '--version'): Promise<boolean> {
  if (found.has(tool)) return true;
  const ok = await probe(tool, [versionArg]);
  if (ok) found.add(tool);
  return ok;
}

export type DockerStatus = 'ok' | 'detenido' | 'no-instalado' | 'contenedores-windows';

export async function dockerStatus(): Promise<DockerStatus> {
  if (!(await probe('docker', ['--version']))) return 'no-instalado';
  // `docker info` necesita el daemon: falla si Docker Desktop está cerrado o faltan permisos
  const os = await output('docker', ['info', '--format', '{{.OSType}}'], 15_000);
  if (os === undefined) return 'detenido';
  // las imágenes de los lenguajes son de Linux: no corren con Docker en modo «contenedores Windows»
  return os.trim() === 'windows' ? 'contenedores-windows' : 'ok';
}

/** Salida estándar de `<cmd> <args>`, o undefined si falla. */
function output(cmd: string, args: string[], timeoutMs = 8000): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = '';
    try {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => (child.kill('SIGKILL'), resolve(undefined)), timeoutMs);
      child.stdout.on('data', (d) => (out += String(d)));
      child.on('error', () => (clearTimeout(timer), resolve(undefined)));
      child.on('close', (code) => (clearTimeout(timer), resolve(code === 0 ? out : undefined)));
    } catch {
      resolve(undefined);
    }
  });
}

const pulled = new Set<string>();

/** Descarga la imagen si no está, con progreso visible. Devuelve false si falla. */
async function ensureImage(imagen: string): Promise<boolean> {
  if (pulled.has(imagen) || (await probe('docker', ['image', 'inspect', imagen]))) {
    pulled.add(imagen);
    return true;
  }
  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Tutor: descargando la imagen de Docker ${imagen} (solo la primera vez)…` },
    () => probe('docker', ['pull', imagen], 10 * 60_000)
  );
  if (ok) pulled.add(imagen);
  else vscode.window.showErrorMessage(`Tutor: no se pudo descargar la imagen ${imagen}. Revisa tu conexión y que Docker esté corriendo.`);
  return ok;
}

/** Comando de instalación para este sistema (en Linux, según el gestor de paquetes que haya). */
export async function installCommand(rt: Runtime): Promise<string | undefined> {
  const i = rt.instalar;
  if (process.platform === 'darwin') return i.darwin && (i.darwin.startsWith('brew') ? ((await hasTool('brew')) ? i.darwin : undefined) : i.darwin);
  if (process.platform === 'win32') return i.win32 && ((await hasTool('winget')) ? i.win32 : undefined);
  if (i.apt && (await hasTool('apt-get'))) return i.apt;
  if (i.dnf && (await hasTool('dnf'))) return i.dnf;
  if (i.pacman && (await hasTool('pacman'))) return i.pacman;
  return undefined;
}

/** Instala la herramienta en una terminal visible (el alumno ve el comando y puede escribir su contraseña). */
async function install(rt: Runtime, tool: string): Promise<void> {
  const cmd = await installCommand(rt);
  if (!cmd) {
    await vscode.env.openExternal(vscode.Uri.parse(rt.instalar.web));
    notify(`Tutor: descarga ${tool} desde la página que se abrió y vuelve a intentarlo.`);
    return;
  }
  const term = vscode.window.createTerminal({ name: `Instalar ${tool}` });
  term.show();
  term.sendText(cmd);
  notify(
    process.platform === 'win32'
      ? `Tutor: instalando ${tool}. Al terminar, reinicia el editor para que encuentre el programa y vuelve a correr.`
      : `Tutor: instalando ${tool}. Cuando termine, vuelve a correr el ejercicio.`
  );
}

/**
 * Decide dónde ejecutar el código del lenguaje:
 *  1. con la herramienta instalada en la máquina, si está;
 *  2. si no, en Docker si el alumno ya lo eligió para ese lenguaje;
 *  3. si no, pregunta: instalarla, usar Docker o cancelar.
 * `tutor.entorno` = "local" o "docker" fuerza una opción. Devuelve undefined si no se puede ejecutar ahora.
 */
export async function ensureRuntime(context: vscode.ExtensionContext, lenguaje?: string): Promise<ExecMode | undefined> {
  const rt = runtimeFor(lenguaje);
  if (!rt) return LOCAL; // sin runtime embebido: el runner explica el error
  const pref = vscode.workspace.getConfiguration('tutor').get<string>('entorno', 'auto');
  const tool = toolFor(rt);
  const lang = lenguaje!.toLowerCase();

  if (pref === 'docker') return (await useDocker(rt)) ? dockerMode(rt) : undefined;
  if (await hasTool(tool, rt.versionArg)) return LOCAL;
  if (pref === 'local') {
    vscode.window.showErrorMessage(`Tutor: ${tool} no está instalado. Instálalo o cambia «tutor.entorno» a «auto» para poder usar Docker.`);
    return undefined;
  }

  const remembered = context.globalState.get<string[]>(DOCKER_KEY, []);
  if (remembered.includes(lang) && (await dockerStatus()) === 'ok') {
    return (await ensureImage(rt.imagen)) ? dockerMode(rt) : undefined;
  }

  const docker = await dockerStatus();
  const INSTALL = `Instalar ${tool}`;
  const DOCKER = 'Usar Docker';
  const GET_DOCKER = 'Cómo instalar Docker';
  const options = [INSTALL, docker === 'ok' ? DOCKER : docker === 'no-instalado' ? GET_DOCKER : undefined].filter((o): o is string => !!o);
  const dockerNote =
    docker === 'ok'
      ? `También puedes correrlo en Docker sin instalar nada (imagen ${rt.imagen}).`
      : docker === 'detenido'
        ? 'Docker está instalado pero no responde: ábrelo y vuelve a intentarlo si prefieres usarlo.'
        : docker === 'contenedores-windows'
          ? 'Docker está en modo «contenedores Windows»: cámbialo a contenedores Linux (menú de Docker Desktop) para poder usarlo.'
        : 'Con Docker podrías correrlo sin instalar nada.';
  const pick = await vscode.window.showWarningMessage(
    `Para correr ${lang} se necesita ${tool}, que no está instalado.`,
    { modal: true, detail: dockerNote },
    ...options
  );
  if (pick === INSTALL) {
    await install(rt, tool);
    return undefined;
  }
  if (pick === GET_DOCKER) {
    await vscode.env.openExternal(vscode.Uri.parse('https://docs.docker.com/get-docker/'));
    return undefined;
  }
  if (pick !== DOCKER || !(await ensureImage(rt.imagen))) return undefined;
  await context.globalState.update(DOCKER_KEY, [...remembered.filter((l) => l !== lang), lang]);
  notify(`Tutor: ${lang} se ejecutará en Docker. Si instalas ${tool}, se usará el tuyo.`);
  return dockerMode(rt);
}

async function useDocker(rt: Runtime): Promise<boolean> {
  const status = await dockerStatus();
  if (status !== 'ok') {
    vscode.window.showErrorMessage(
      status === 'detenido'
        ? 'Tutor: «tutor.entorno» es «docker», pero Docker no responde. Ábrelo y vuelve a intentarlo.'
        : status === 'contenedores-windows'
          ? 'Tutor: Docker está en modo «contenedores Windows». Cámbialo a contenedores Linux en Docker Desktop.'
        : 'Tutor: «tutor.entorno» es «docker», pero Docker no está instalado.'
    );
    return false;
  }
  return ensureImage(rt.imagen);
}
