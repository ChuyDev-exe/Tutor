/** Runtimes embebidos por lenguaje (ejecutar código y pruebas por casos). */
export const RUNTIMES: Record<string, { ext: string; cmd: (file: string) => string[]; timeoutMs: number }> = {
  python: { ext: '.py', cmd: (f) => [process.platform === 'win32' ? 'python' : 'python3', f], timeoutMs: 15_000 },
  javascript: { ext: '.js', cmd: (f) => ['node', f], timeoutMs: 15_000 },
  typescript: { ext: '.ts', cmd: (f) => ['npx', '-y', 'tsx', f], timeoutMs: 30_000 },
  bash: { ext: '.sh', cmd: (f) => ['bash', f], timeoutMs: 15_000 },
  c: { ext: '.c', cmd: (f) => ['sh', '-c', 'gcc "$0" -o "$0.out" -lm && "$0.out"', f], timeoutMs: 30_000 },
  cpp: { ext: '.cpp', cmd: (f) => ['sh', '-c', 'g++ "$0" -o "$0.out" && "$0.out"', f], timeoutMs: 30_000 },
  go: { ext: '.go', cmd: (f) => ['go', 'run', f], timeoutMs: 30_000 },
};


export function runtimeFor(lenguaje?: string): { ext: string; cmd: (file: string) => string[]; timeoutMs: number } | undefined {
  if (!lenguaje) return undefined;
  return RUNTIMES[lenguaje.toLowerCase()];
}
