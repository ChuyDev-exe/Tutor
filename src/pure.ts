/**
 * Lógica pura (sin dependencias de VS Code): se puede probar con `npm test`.
 */
import { createHash } from 'crypto';
import { CourseSummary, QuizItem, QuizQuestion, QuizTipo } from './types';

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
  if (q.tipo === 'arrastrar') {
    // ans[i]: zona donde el alumno dejó el elemento i (-1 si no lo colocó)
    return Array.isArray(ans) && ans.length === q.correctas.length && q.correctas.every((z, i) => ans[i] === z);
  }
  if (q.tipo === 'texto') {
    return typeof ans === 'string' && !!ans.trim() && q.aceptadas.some((a) => normText(a) === normText(ans));
  }
  if (!Array.isArray(ans) || !ans.length) return false;
  const given = [...new Set(ans)].sort();
  const right = [...q.correctas].sort();
  return given.length === right.length && given.every((v, i) => v === right[i]);
}

/**
 * Convierte la `evaluacion` de un curso.json en preguntas; descarta las inválidas.
 * `asset` traduce la ruta de una imagen (relativa al curso) a una ruta utilizable, o undefined si no es válida.
 */
export function parseQuiz(raw: any, asset: (rel: string) => string | undefined = () => undefined): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  const img = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? asset(v.trim()) : undefined);
  const item = (v: any): QuizItem | undefined => {
    if (typeof v === 'string' || typeof v === 'number') return String(v).trim() ? { texto: String(v).trim() } : undefined;
    if (!v || typeof v !== 'object') return undefined;
    const texto = String(v.texto ?? '').trim();
    const imagen = img(v.imagen);
    return texto || imagen ? { texto, imagen } : undefined;
  };
  (Array.isArray(raw) ? raw : []).forEach((q: any, i: number) => {
    const pregunta = String(q?.pregunta || '').trim();
    if (!pregunta) return;
    const base = {
      id: String(q.id || `q${i + 1}`),
      pregunta,
      codigo: q.codigo ? String(q.codigo) : undefined,
      imagen: img(q.imagen),
      explicacion: q.explicacion ? String(q.explicacion) : undefined,
      aceptadas: [] as string[],
    };
    const tipo: QuizTipo = ['unica', 'multiple', 'vf', 'texto', 'arrastrar'].includes(q.tipo) ? q.tipo : 'unica';
    if (tipo === 'arrastrar') {
      const zonasRaw: any[] = Array.isArray(q.zonas) ? q.zonas : [];
      const zonas = zonasRaw.map(item);
      if (zonas.length < 2 || zonas.some((z) => !z)) return;
      const elementos: QuizItem[] = [];
      const correctas: number[] = [];
      for (const e of Array.isArray(q.elementos) ? q.elementos : []) {
        const it = item(e);
        const zona = zoneIndex(e?.zona, zonasRaw);
        if (!it || zona < 0) return;
        elementos.push(it);
        correctas.push(zona);
      }
      if (elementos.length) out.push({ ...base, tipo, opciones: [], correctas, zonas: zonas as QuizItem[], elementos });
    } else if (tipo === 'vf') {
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

/** Zona de un elemento de arrastrar: índice (desde 0) o el texto de la zona (sin distinguir mayúsculas ni acentos). */
export function zoneIndex(zona: unknown, zonas: any[]): number {
  if (typeof zona === 'number') return Number.isInteger(zona) && zona >= 0 && zona < zonas.length ? zona : -1;
  if (typeof zona !== 'string' || !zona.trim()) return -1;
  const key = normText(zona);
  return zonas.findIndex((z) => normText(String(typeof z === 'object' && z ? z.texto ?? '' : z)) === key);
}

/** Temario y cifras de un curso.json (sin leer más archivos). */
export function summarizeCourse(raw: any): CourseSummary {
  const caps: any[] = Array.isArray(raw?.capitulos) ? raw.capitulos : [];
  const capitulos = caps.map((c) => ({
    titulo: String(c?.titulo ?? c?.id ?? ''),
    descripcion: String(c?.descripcion ?? ''),
    minutos: Number(c?.minutos) > 0 ? Number(c.minutos) : undefined,
    ejercicios: Array.isArray(c?.ejercicios) ? c.ejercicios.length : 0,
    preguntas: Array.isArray(c?.evaluacion) ? c.evaluacion.length : 0,
  }));
  const lenguajes = new Set<string>();
  for (const c of caps) for (const e of c?.ejercicios ?? []) if (e?.lenguaje) lenguajes.add(String(e.lenguaje));
  return {
    capitulos,
    minutos: capitulos.reduce((n, c) => n + (c.minutos ?? 0), 0),
    ejercicios: capitulos.reduce((n, c) => n + c.ejercicios, 0),
    preguntas: capitulos.reduce((n, c) => n + c.preguntas, 0),
    requisitos: (Array.isArray(raw?.requisitos) ? raw.requisitos : [])
      .filter((r: any) => r && typeof r.comando === 'string')
      .map((r: any) => String(r.nombre || r.comando) + (r.versionMinima ? ` ≥ ${r.versionMinima}` : '')),
    lenguajes: [...lenguajes],
  };
}

/** 95 → «1 h 35 min» · 40 → «40 min» · 0 → «». */
export function formatMinutes(min: number): string {
  if (!(min > 0)) return '';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/**
 * Repositorio de GitHub: «owner/repo», «owner/repo@rama» o una URL https://github.com/owner/repo[/tree/rama].
 * Devuelve undefined si no tiene ese formato.
 */
export function parseGithubRepo(spec: string): { owner: string; repo: string; ref: string } | undefined {
  const s = spec.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const name = '[A-Za-z0-9_.-]+';
  const ref = '[A-Za-z0-9_./-]+';
  let m = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${name})/(${name})(?:/tree/(${ref}))?$`).exec(s);
  if (!m) m = new RegExp(`^(${name})/(${name})(?:@(${ref}))?$`).exec(s);
  if (!m || [m[1], m[2]].some((p) => p === '.' || p === '..')) return undefined;
  return { owner: m[1], repo: m[2], ref: m[3] || 'HEAD' };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

/** ¿Es una ruta relativa a una imagen (no URL, no absoluta, no ancla)? */
export const isLocalImageRef = (ref: string): boolean =>
  !!ref && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref) && IMAGE_EXT.test(ref.split(/[?#]/)[0]);

/** `![alt](ruta "título")` o `![alt](<ruta con espacios>)`: 1 inicio · 2 «<» · 3 ruta entre <> · 4 ruta · 5 resto. */
const MD_IMG = /(!\[[^\]]*\]\(\s*)(<?)(?:([^>\n]+)(?=>)|([^)\s]+))(>?(?:\s+["'][^"'\n]*["'])?\s*\))/g;

/** Rutas de imágenes locales referenciadas en un Markdown: `![alt](ruta)` e `<img src="ruta">`. */
export function markdownImageRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(MD_IMG)) refs.add(m[3] ?? m[4]);
  for (const m of text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) refs.add(m[1]);
  return [...refs].map((r) => { try { return decodeURI(r); } catch { return r; } }).filter(isLocalImageRef);
}

/** Reemplaza cada referencia de imagen local de un Markdown por lo que devuelva `map` (undefined = sin cambio). */
export function rewriteMarkdownImages(text: string, map: (ref: string) => string | undefined): string {
  const sub = (ref: string): string | undefined => {
    let dec = ref;
    try { dec = decodeURI(ref); } catch { /* se usa tal cual */ }
    return isLocalImageRef(dec) ? map(dec) : undefined;
  };
  return text
    .replace(MD_IMG, (all, a, lt, angled, plain, b) => {
      const n = sub(angled ?? plain);
      return n === undefined ? all : a + lt + n + b;
    })
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (all, a, ref, b) => {
      const n = sub(ref);
      return n === undefined ? all : a + n + b;
    });
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

// ── Archivo de dudas (dudas-y-preguntas.md) ───────────────────────────
export interface DoubtEntry {
  dia: string;
  hora: string;
  donde: string;
  pregunta: string;
  respuesta: string;
  /** Línea (0-based) del encabezado `### hora · dónde`. */
  linea: number;
}

const FENCE = /^\s*(```|~~~)/;

/** Baja los encabezados de una respuesta a negritas (fuera de bloques de código) para no romper el archivo. */
export function flattenHeadings(md: string): string {
  let inCode = false;
  return md
    .split('\n')
    .map((l) => {
      if (FENCE.test(l)) inCode = !inCode;
      return inCode ? l : l.replace(/^#{1,6}\s+(.*)$/, '**$1**');
    })
    .join('\n');
}

/** Lee las entradas del archivo de dudas en el orden en que se guardaron. */
export function parseDoubts(md: string): DoubtEntry[] {
  const rows = md.split(/\r?\n/);
  const out: DoubtEntry[] = [];
  let dia = '';
  let cur: (DoubtEntry & { body: string[] }) | undefined;
  let inCode = false;
  const close = (): void => {
    if (!cur) return;
    const body = cur.body;
    const at = body.findIndex((l) => l.trim() === '**Respuesta del tutor:**');
    const ans = at < 0 ? [] : body.slice(at + 1);
    while (ans.length && /^(\s*|---)$/.test(ans[ans.length - 1])) ans.pop();
    const { body: _b, ...entry } = cur;
    out.push({ ...entry, respuesta: ans.join('\n').trim() });
    cur = undefined;
  };
  rows.forEach((l, i) => {
    if (FENCE.test(l)) inCode = !inCode;
    if (!inCode) {
      const d = /^## (\d{4}-\d{2}-\d{2})\s*$/.exec(l);
      if (d) {
        close();
        dia = d[1];
        return;
      }
      const h = /^### (\d{1,2}:\d{2}) · (.*)$/.exec(l);
      if (h) {
        close();
        cur = { dia, hora: h[1], donde: h[2].trim(), pregunta: '', respuesta: '', linea: i, body: [] };
        return;
      }
    }
    if (!cur) return;
    const q = /^\*\*Pregunta:\*\* (.*)$/.exec(l);
    if (q && !cur.pregunta) cur.pregunta = q[1].trim();
    else cur.body.push(l);
  });
  close();
  return out;
}
