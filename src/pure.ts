/**
 * Lógica pura (sin dependencias de VS Code): se puede probar con `npm test`.
 */
import { createHash } from 'crypto';
import { QuizQuestion, QuizTipo } from './types';

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/^[\d\s.\-_]+/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}


/** Nombre de ejecutable permitido en `requisitos` (sin rutas, espacios ni metacaracteres de shell). */
export const isSafeCommand = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(s);

/** Argumento de versión permitido: --version, -v, -V, version… (sin espacios ni metacaracteres). */
export const isSafeVersionArg = (s: unknown): s is string => typeof s === 'string' && /^(--?)?[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(s);

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export const normText = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Califica una pregunta. `ans`: índices elegidos (opciones) o texto (respuesta corta). */
export function gradeQuestion(q: QuizQuestion, ans: number[] | string | undefined): boolean {
  if (q.tipo === 'texto') {
    return typeof ans === 'string' && !!ans.trim() && q.aceptadas.some((a) => normText(a) === normText(ans));
  }
  if (!Array.isArray(ans) || !ans.length) return false;
  const given = [...new Set(ans)].sort();
  const right = [...q.correctas].sort();
  return given.length === right.length && given.every((v, i) => v === right[i]);
}

export function parseQuiz(raw: any): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  (Array.isArray(raw) ? raw : []).forEach((q: any, i: number) => {
    const pregunta = String(q?.pregunta || '').trim();
    if (!pregunta) return;
    const base = {
      id: String(q.id || `q${i + 1}`),
      pregunta,
      codigo: q.codigo ? String(q.codigo) : undefined,
      explicacion: q.explicacion ? String(q.explicacion) : undefined,
      aceptadas: [] as string[],
    };
    const tipo: QuizTipo = ['unica', 'multiple', 'vf', 'texto'].includes(q.tipo) ? q.tipo : 'unica';
    if (tipo === 'vf') {
      const v = q.respuesta === true || String(q.respuesta).toLowerCase() === 'verdadero';
      out.push({ ...base, tipo, opciones: ['Verdadero', 'Falso'], correctas: [v ? 0 : 1] });
    } else if (tipo === 'texto') {
      const acc = (Array.isArray(q.aceptadas) ? q.aceptadas : [q.respuesta]).map((x: any) => String(x).trim()).filter(Boolean);
      if (acc.length) out.push({ ...base, tipo, opciones: [], correctas: [], aceptadas: acc });
    } else {
      const opciones: string[] = Array.isArray(q.opciones) ? q.opciones.map(String) : [];
      const nums = (Array.isArray(q.respuestas) ? q.respuestas : [q.respuesta]).map(Number);
      const correctas = nums.filter((n: number) => Number.isInteger(n) && n >= 0 && n < opciones.length);
      if (opciones.length >= 2 && correctas.length) {
        out.push({ ...base, tipo: tipo === 'multiple' || correctas.length > 1 ? 'multiple' : 'unica', opciones, correctas });
      }
    }
  });
  return out;
}


export interface ScriptRisk {
  nivel: 'critico' | 'aviso' | 'info';
  etiqueta: string;
  linea: number;
}

export interface ScriptAnalysis {
  lineas: number;
  /** Comandos efectivos (sin comentarios ni líneas vacías), recortados. */
  comandos: string[];
  riesgos: ScriptRisk[];
  sha: string;
}

const RISK_RULES: { re: RegExp; nivel: ScriptRisk['nivel']; etiqueta: string }[] = [
  { re: /(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, nivel: 'critico', etiqueta: 'descarga y ejecuta código remoto (curl | sh)' },
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~\/?|\$HOME\/?|\*)(\s|$)/, nivel: 'critico', etiqueta: 'borra de forma recursiva fuera de una carpeta concreta (rm -rf)' },
  { re: /\b(mkfs|fdisk|diskutil\s+erase)\b|\bdd\s+if=|>\s*\/dev\/(sd|nvme|disk)/, nivel: 'critico', etiqueta: 'opera sobre discos o dispositivos' },
  { re: /\beval\b|base64\s+(-d|--decode)/, nivel: 'critico', etiqueta: 'ejecuta código ofuscado o construido en tiempo de ejecución (eval / base64)' },
  { re: /\bsudo\b|\bsu\s+-?\w*\b/, nivel: 'aviso', etiqueta: 'pide permisos de administrador (sudo)' },
  { re: /\brm\s+-[a-zA-Z]*[rf]/, nivel: 'aviso', etiqueta: 'borra archivos (rm)' },
  { re: /\b(chmod|chown)\b/, nivel: 'aviso', etiqueta: 'cambia permisos de archivos' },
  { re: /\b(crontab|launchctl|systemctl|at\s+now)\b/, nivel: 'aviso', etiqueta: 'programa tareas o servicios que siguen activos' },
  { re: /(\/etc\/|~\/\.|\$HOME\/\.|>>?\s*~\/)/, nivel: 'aviso', etiqueta: 'modifica archivos de configuración fuera de tu carpeta de trabajo' },
  { re: /\b(curl|wget)\b/, nivel: 'aviso', etiqueta: 'descarga archivos de internet' },
  { re: /\b(apt(-get)?|brew|pip3?|npm|yarn|cargo|gem|dnf|yum)\s+(install|add)\b/, nivel: 'info', etiqueta: 'instala software' },
];

/** Resume un script de shell y detecta operaciones delicadas (heurística: no es una garantía). */
export function analyzeScript(text: string): ScriptAnalysis {
  const rows = text.split(/\r?\n/);
  const comandos: string[] = [];
  const riesgos: ScriptRisk[] = [];
  rows.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    comandos.push(line.length > 110 ? line.slice(0, 107) + '…' : line);
    for (const rule of RISK_RULES) {
      if (rule.re.test(line)) {
        riesgos.push({ nivel: rule.nivel, etiqueta: rule.etiqueta, linea: i + 1 });
        break; // una etiqueta por línea: la más grave
      }
    }
  });
  return { lineas: rows.length, comandos, riesgos, sha: createHash('sha256').update(text).digest('hex') };
}
