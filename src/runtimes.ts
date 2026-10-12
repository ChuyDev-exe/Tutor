/** Runtime embebido de un lenguaje (ejecutar código y pruebas por casos). */
export interface Runtime {
  ext: string;
  /** Comando que ejecuta el programa: el archivo fuente o, si hay `compile`, el binario. */
  cmd: (file: string) => string[];
  /** Compilación previa (C, C++): se hace UNA vez antes de correr o de todos los casos. */
  compile?: (file: string) => string[];
  timeoutMs: number;
}

/** Binario que produce la compilación de `file` (con .exe en Windows). */
export const binaryFor = (file: string): string => file.replace(/\.[^./\\]+$/, '') + (process.platform === 'win32' ? '.exe' : '.out');

/** Runtimes embebidos por lenguaje. Sin `sh -c`: funcionan igual en macOS, Linux y Windows. */
export const RUNTIMES: Record<string, Runtime> = {
  python: { ext: '.py', cmd: (f) => [process.platform === 'win32' ? 'python' : 'python3', f], timeoutMs: 15_000 },
  javascript: { ext: '.js', cmd: (f) => ['node', f], timeoutMs: 15_000 },
  typescript: { ext: '.ts', cmd: (f) => ['npx', '-y', 'tsx', f], timeoutMs: 30_000 },
  bash: { ext: '.sh', cmd: (f) => ['bash', f], timeoutMs: 15_000 },
  c: { ext: '.c', compile: (f) => ['gcc', f, '-o', binaryFor(f), '-lm'], cmd: (f) => [binaryFor(f)], timeoutMs: 15_000 },
  cpp: { ext: '.cpp', compile: (f) => ['g++', f, '-o', binaryFor(f)], cmd: (f) => [binaryFor(f)], timeoutMs: 15_000 },
  go: { ext: '.go', cmd: (f) => ['go', 'run', f], timeoutMs: 30_000 },
};

/** Tiempo máximo de una compilación. */
export const COMPILE_TIMEOUT_MS = 60_000;

export function runtimeFor(lenguaje?: string): Runtime | undefined {
  if (!lenguaje) return undefined;
  return RUNTIMES[lenguaje.toLowerCase()];
}
