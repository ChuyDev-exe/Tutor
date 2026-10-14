import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

/** Comandos para instalar una herramienta, por sistema (en Linux, por gestor de paquetes). */
export interface InstallCommands {
  darwin?: string;
  win32?: string;
  apt?: string;
  dnf?: string;
  pacman?: string;
  /** Página de descarga, si no hay gestor de paquetes. */
  web: string;
}

/** Runtime embebido de un lenguaje (ejecutar código y pruebas por casos). */
export interface Runtime {
  ext: string;
  /** Comando que ejecuta el programa: el archivo fuente o, si hay `compile`, el binario. */
  cmd: (file: string) => string[];
  /** Compilación previa (C, C++): se hace UNA vez antes de correr o de todos los casos. */
  compile?: (file: string) => string[];
  timeoutMs: number;
  /** Argumento con el que se comprueba que la herramienta está instalada (default --version). */
  versionArg?: string;
  /** Imagen de Docker con la que correr si la herramienta no está instalada. */
  imagen: string;
  /** El contenedor necesita red (p. ej. `npx` descarga paquetes). Por defecto, sin red. */
  red?: boolean;
  instalar: InstallCommands;
}

/** Binario que produce la compilación de `file` (con .exe en Windows). */
export const binaryFor = (file: string): string => file.replace(/\.[^./\\]+$/, '') + (process.platform === 'win32' ? '.exe' : '.out');

const NODE_INSTALL: InstallCommands = {
  darwin: 'brew install node',
  win32: 'winget install -e --id OpenJS.NodeJS.LTS',
  apt: 'sudo apt-get install -y nodejs npm',
  dnf: 'sudo dnf install -y nodejs npm',
  pacman: 'sudo pacman -S --noconfirm nodejs npm',
  web: 'https://nodejs.org/es/download',
};

const gccInstall = (dnfPkg: string): InstallCommands => ({
  darwin: 'xcode-select --install',
  win32: 'winget install -e --id BrechtSanders.WinLibs.POSIX.UCRT',
  apt: 'sudo apt-get install -y build-essential',
  dnf: `sudo dnf install -y ${dnfPkg}`,
  pacman: 'sudo pacman -S --noconfirm gcc',
  web: 'https://gcc.gnu.org/install/binaries.html',
});

/** Runtimes embebidos por lenguaje. Sin `sh -c`: funcionan igual en macOS, Linux y Windows. */
export const RUNTIMES: Record<string, Runtime> = {
  python: {
    ext: '.py',
    cmd: (f) => [process.platform === 'win32' ? 'python' : 'python3', f],
    timeoutMs: 15_000,
    imagen: 'python:3.12-slim',
    instalar: {
      darwin: 'brew install python',
      win32: 'winget install -e --id Python.Python.3.12',
      apt: 'sudo apt-get install -y python3',
      dnf: 'sudo dnf install -y python3',
      pacman: 'sudo pacman -S --noconfirm python',
      web: 'https://www.python.org/downloads/',
    },
  },
  javascript: { ext: '.js', cmd: (f) => ['node', f], timeoutMs: 15_000, imagen: 'node:22-slim', instalar: NODE_INSTALL },
  typescript: { ext: '.ts', cmd: (f) => ['npx', '-y', 'tsx', f], timeoutMs: 30_000, imagen: 'node:22-slim', red: true, instalar: NODE_INSTALL },
  bash: {
    ext: '.sh',
    cmd: (f) => ['bash', f],
    timeoutMs: 15_000,
    imagen: 'bash:5.2',
    instalar: {
      win32: 'winget install -e --id Git.Git',
      apt: 'sudo apt-get install -y bash',
      dnf: 'sudo dnf install -y bash',
      pacman: 'sudo pacman -S --noconfirm bash',
      web: 'https://git-scm.com/downloads',
    },
  },
  c: {
    ext: '.c',
    compile: (f) => ['gcc', f, '-o', binaryFor(f), '-lm'],
    cmd: (f) => [binaryFor(f)],
    timeoutMs: 15_000,
    imagen: 'gcc:14',
    instalar: gccInstall('gcc'),
  },
  cpp: {
    ext: '.cpp',
    compile: (f) => ['g++', f, '-o', binaryFor(f)],
    cmd: (f) => [binaryFor(f)],
    timeoutMs: 15_000,
    imagen: 'gcc:14',
    instalar: gccInstall('gcc-c++'),
  },
  go: {
    ext: '.go',
    cmd: (f) => ['go', 'run', f],
    timeoutMs: 30_000,
    versionArg: 'version',
    imagen: 'golang:1.23',
    instalar: {
      darwin: 'brew install go',
      win32: 'winget install -e --id GoLang.Go',
      apt: 'sudo apt-get install -y golang-go',
      dnf: 'sudo dnf install -y golang',
      pacman: 'sudo pacman -S --noconfirm go',
      web: 'https://go.dev/dl/',
    },
  },
};

/** Tiempo máximo de una compilación. */
export const COMPILE_TIMEOUT_MS = 60_000;
/** Margen extra en Docker: arrancar un contenedor tarda más que un proceso. */
export const DOCKER_EXTRA_MS = 15_000;

export function runtimeFor(lenguaje?: string): Runtime | undefined {
  if (!lenguaje) return undefined;
  return RUNTIMES[lenguaje.toLowerCase()];
}

/** Ejecutable que debe estar instalado para usar el runtime en local (el compilador, si lo hay). */
export const toolFor = (rt: Runtime): string => (rt.compile ?? rt.cmd)('x')[0];

/** Dónde se ejecuta el código: en la máquina del alumno o en un contenedor. */
export type ExecMode = { kind: 'local' } | { kind: 'docker'; imagen: string; red?: boolean };
export const LOCAL: ExecMode = { kind: 'local' };

export const dockerMode = (rt: Runtime): ExecMode => ({ kind: 'docker', imagen: rt.imagen, red: rt.red });

export interface PreparedCommand {
  argv: string[];
  /** Detiene el proceso de verdad: en Docker, matar el cliente no para el contenedor. */
  stop?: () => void;
}

/** `node_modules` más cercano subiendo desde `dir` (hasta 3 niveles), con el enlace ya resuelto. */
export function nearestNodeModules(dir: string): string | undefined {
  for (let d = dir, i = 0; i < 4; i++, d = path.dirname(d)) {
    try {
      return fs.realpathSync(path.join(d, 'node_modules'));
    } catch {
      /* sigue subiendo */
    }
    if (path.dirname(d) === d) break;
  }
  return undefined;
}

/**
 * Construye el comando a lanzar para `file`. En Docker, la carpeta del archivo se monta en /work
 * y `make` recibe la ruta dentro del contenedor. `montajes` añade archivos de solo lectura (host → contenedor).
 */
export function buildCommand(
  make: (file: string) => string[],
  file: string,
  mode: ExecMode = LOCAL,
  montajes: [string, string][] = []
): PreparedCommand {
  if (mode.kind === 'local') return { argv: make(file) };
  // node_modules compartido del curso (en una carpeta superior): Node lo busca subiendo desde /work
  const modules = nearestNodeModules(path.dirname(file));
  if (modules) montajes = [...montajes, [modules, '/node_modules']];
  const name = `tutor-ide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // en Linux el contenedor escribe con tu usuario, para que el binario compilado no quede como root
  const user = typeof process.getuid === 'function' && process.platform === 'linux' ? ['--user', `${process.getuid()}:${process.getgid?.()}`] : [];
  const argv = [
    'docker', 'run', '--rm', '-i', '--init', '--name', name,
    ...(mode.red ? [] : ['--network', 'none']),
    '--memory', '512m',
    ...user,
    '--mount', `type=bind,source=${path.dirname(file)},target=/work`,
    ...montajes.flatMap(([host, target]) => ['--mount', `type=bind,source=${host},target=${target},readonly`]),
    '-w', '/work',
    '-e', 'HOME=/tmp',
    '-e', 'PYTHONUNBUFFERED=1',
    mode.imagen,
    ...make(`/work/${path.basename(file)}`),
  ];
  const stop = () => {
    try {
      spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => {});
    } catch {
      /* el contenedor ya no existe */
    }
  };
  return { argv, stop };
}

/**
 * En Windows, `npx`/`npm` son scripts .cmd y Node exige lanzarlos con shell;
 * entonces cada argumento va entre comillas para no partir rutas con espacios.
 */
export function spawnArgs(argv: string[]): { cmd: string; args: string[]; shell: boolean } {
  if (process.platform === 'win32' && /^(npx|npm)$/i.test(argv[0])) {
    return { cmd: argv[0], args: argv.slice(1).map((a) => `"${a.replace(/"/g, '\\"')}"`), shell: true };
  }
  return { cmd: argv[0], args: argv.slice(1), shell: false };
}
