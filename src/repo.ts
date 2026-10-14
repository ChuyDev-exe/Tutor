import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RepoCatalog, RepoCourseEntry } from './types';
import { tutorState } from './state';
import { markdownImageRefs, parseGithubRepo, summarizeCourse } from './pure';

/** Repositorio de cursos por defecto (se usa si no hay `tutor.repoCatalogUrl`). */
export const DEFAULT_GITHUB_REPO = 'ChuyDev-exe/Tutor-Cursos';

export function getCatalogUrl(): string {
  return (
    vscode.workspace.getConfiguration('tutor').get<string>('repoCatalogUrl')?.trim() || ''
  );
}

export function getGithubRepo(): string {
  return vscode.workspace.getConfiguration('tutor').get<string>('repoGithub')?.trim() || '';
}

/** Repositorios de GitHub que el alumno agregó (además del oficial). */
export function getExtraRepos(): string[] {
  const list = vscode.workspace.getConfiguration('tutor').get<string[]>('repositorios') ?? [];
  return (Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean);
}

/** «owner/repo» o «owner/repo@rama», para comparar y guardar. */
const repoId = (spec: string): string | undefined => {
  const gh = parseGithubRepo(spec);
  return gh && `${gh.owner}/${gh.repo}${gh.ref === 'HEAD' ? '' : `@${gh.ref}`}`;
};

/** Agrega un repositorio (URL u owner/repo) a `tutor.repositorios`. Devuelve su nombre normalizado. */
export async function addRepo(spec: string): Promise<string> {
  const id = repoId(spec);
  if (!id) throw new Error(`«${spec}» no es un repositorio de GitHub. Usa https://github.com/owner/repo u owner/repo.`);
  const same = (s: string) => repoId(s)?.toLowerCase() === id.toLowerCase();
  if (same(getGithubRepo()) || getExtraRepos().some(same)) return id;
  await vscode.workspace
    .getConfiguration('tutor')
    .update('repositorios', [...getExtraRepos(), id], vscode.ConfigurationTarget.Global);
  cache = undefined;
  return id;
}

export async function removeRepo(spec: string): Promise<void> {
  const id = repoId(spec)?.toLowerCase();
  await vscode.workspace
    .getConfiguration('tutor')
    .update('repositorios', getExtraRepos().filter((s) => repoId(s)?.toLowerCase() !== id), vscode.ConfigurationTarget.Global);
  cache = undefined;
}

/** Lista de cursos disponibles y de dónde salen. */
export interface RepoListing {
  nombre: string;
  /** Página del repositorio (para «Ver en GitHub»). */
  webUrl?: string;
  /** Aviso para el alumno (p. ej. el catálogo falló y se usó GitHub). */
  aviso?: string;
  cursos: RepoCourseEntry[];
}

const CACHE_MS = 5 * 60 * 1000;
let cache: { key: string; at: number; listing: RepoListing } | undefined;

/** Cursos del repositorio principal: `tutor.repoCatalogUrl` (un catalogo.json) o, si no hay, `tutor.repoGithub`. */
async function listMain(): Promise<RepoListing> {
  const catalogUrl = getCatalogUrl();
  const github = getGithubRepo();
  if (!catalogUrl) {
    if (!github) throw new Error('Configura tutor.repoGithub (owner/repo) o tutor.repoCatalogUrl para ver cursos.');
    return listFromGithub(github);
  }
  // una URL de repositorio de GitHub en el ajuste del catálogo es un error habitual: se lee como repositorio
  if (/github\.com\//i.test(catalogUrl) && parseGithubRepo(catalogUrl)) return listFromGithub(catalogUrl);
  try {
    return await listFromCatalog(catalogUrl);
  } catch (err) {
    // un catálogo caído o mal escrito no deja al alumno sin cursos si hay repositorio de GitHub
    if (!github) throw err;
    const listing = await listFromGithub(github);
    listing.aviso = `${err instanceof Error ? err.message : err} Se muestran los cursos de ${listing.nombre}.`;
    return listing;
  }
}

/**
 * Cursos disponibles: los del repositorio principal más los de `tutor.repositorios`.
 * Si un repositorio falla, los demás se muestran igual con un aviso. Con ids repetidos gana el primero.
 * El resultado se guarda unos minutos; `force` lo vuelve a leer.
 */
export async function listRepoCourses(force = false): Promise<RepoListing> {
  // sin repetidos ni el principal (si alguien lo agregó también a mano)
  const seen = new Set([repoId(getGithubRepo())?.toLowerCase()]);
  const extras = getExtraRepos().filter((r) => {
    const id = repoId(r)?.toLowerCase() ?? r;
    return !seen.has(id) && !!seen.add(id);
  });
  const key = JSON.stringify([getCatalogUrl(), getGithubRepo(), extras]);
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.listing;
  const results = await Promise.allSettled([listMain(), ...extras.map((r) => listFromGithub(r))]);
  const avisos: string[] = [];
  const cursos: RepoCourseEntry[] = [];
  const names: string[] = [];
  let webUrl: string | undefined;
  results.forEach((r, i) => {
    const source = i === 0 ? 'el repositorio principal' : extras[i - 1];
    if (r.status === 'rejected') {
      avisos.push(i === 0 ? String(r.reason instanceof Error ? r.reason.message : r.reason) : `${source}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      return;
    }
    names.push(r.value.nombre);
    webUrl ??= r.value.webUrl;
    if (r.value.aviso) avisos.push(r.value.aviso);
    for (const c of r.value.cursos) {
      const dup = cursos.find((x) => x.id === c.id);
      if (dup) avisos.push(`«${c.titulo}» de ${r.value.nombre} se omitió: ${dup.repo} ya tiene un curso con el id «${c.id}».`);
      else cursos.push({ ...c, repo: r.value.nombre });
    }
  });
  if (!names.length) throw new Error(avisos.join(' '));
  const listing: RepoListing = {
    nombre: names.join(' · '),
    webUrl,
    aviso: avisos.join(' ') || undefined,
    cursos,
  };
  cache = { key, at: Date.now(), listing };
  return listing;
}

/**
 * Descarga los cursos del repositorio oficial que aún no están instalados (cursos de inicio).
 * Devuelve los ids instalados y los errores de los que fallaron.
 */
export async function installStarterCourses(installed: string[]): Promise<{ ids: string[]; errores: string[] }> {
  const listing = await listFromGithub(getGithubRepo() || DEFAULT_GITHUB_REPO);
  const ids: string[] = [];
  const errores: string[] = [];
  for (const entry of listing.cursos) {
    if (installed.includes(entry.id)) continue;
    try {
      await downloadCourse(entry);
      ids.push(entry.id);
    } catch (err) {
      errores.push(`${entry.titulo}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { ids, errores };
}

/** Busca un curso en la última lista leída (el webview solo envía ids: el resto lo decide el host). */
export function cachedEntry(id: string): RepoCourseEntry | undefined {
  return cache?.listing.cursos.find((c) => c.id === id);
}

/** Temario de un curso: si la lista no lo trae, lee su curso.json. */
export async function loadSummary(entry: RepoCourseEntry): Promise<RepoCourseEntry> {
  if (entry.resumen || !entry.baseUrl) return entry;
  const manifest = await fetchJson(`${entry.baseUrl}curso.json`);
  entry.resumen = summarizeCourse(manifest);
  return entry;
}

export async function fetchCatalog(): Promise<RepoCatalog> {
  const url = getCatalogUrl();
  if (!url) {
    throw new Error(
      'Configura tutor.repoCatalogUrl con la URL del catalogo.json del repositorio de cursos.'
    );
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('tutor.repoCatalogUrl debe empezar con http:// o https://');
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error(`No se pudo conectar con ${url}. Revisa tutor.repoCatalogUrl o déjalo vacío para usar el repositorio de GitHub.`);
  }
  if (!res.ok) {
    throw new Error(
      `No se pudo leer el catálogo ${url} (HTTP ${res.status}). Ese ajuste, tutor.repoCatalogUrl, reemplaza al repositorio de GitHub: ` +
        'corrígelo o déjalo vacío para ver los cursos de tutor.repoGithub.'
    );
  }
  const data = (await res.json()) as RepoCatalog;
  if (!Array.isArray(data.cursos)) throw new Error('El catálogo no tiene la lista "cursos".');
  return data;
}

async function listFromCatalog(catalogUrl: string): Promise<RepoListing> {
  const catalog = await fetchCatalog();
  const base = catalogUrl.slice(0, catalogUrl.lastIndexOf('/') + 1);
  return {
    nombre: catalog.nombre || catalogUrl,
    cursos: catalog.cursos.map((c) => ({
      ...c,
      baseUrl: `${base}${(c.ruta || `cursos/${c.id}`).replace(/^\/+|\/+$/g, '')}/`,
      resumen: undefined,
    })),
  };
}

const GH_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'tutor-ide' };

async function listFromGithub(spec: string): Promise<RepoListing> {
  const gh = parseGithubRepo(spec);
  if (!gh) throw new Error(`tutor.repoGithub debe tener la forma owner/repo (es «${spec}»).`);
  const { owner, repo, ref } = gh;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: GH_HEADERS }
  );
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub limitó las consultas desde tu red. Vuelve a intentarlo en unos minutos.');
  }
  if (!res.ok) throw new Error(`No se pudo leer ${owner}/${repo} en GitHub (HTTP ${res.status}).`);
  const tree = (await res.json()) as { tree?: { path: string; type: string }[] };
  const blobs = (tree.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path);

  // cada carpeta con un curso.json es un curso; sus archivos son todo lo que cuelga de ella
  const dirs = blobs
    .filter((p) => p === 'curso.json' || p.endsWith('/curso.json'))
    .map((p) => p.slice(0, -'curso.json'.length));
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`;
  const web = `https://github.com/${owner}/${repo}`;
  const results = await Promise.allSettled(
    dirs.map(async (dir): Promise<RepoCourseEntry> => {
      const baseUrl = raw + dir.split('/').map(encodeURIComponent).join('/');
      const manifest = await fetchJson(`${baseUrl}curso.json`);
      const archivos = blobs
        .filter((p) => p.startsWith(dir) && !p.slice(dir.length).split('/').some((s) => s.startsWith('.')))
        .map((p) => p.slice(dir.length));
      const id = String(manifest.id || path.posix.basename(dir) || repo);
      const tags = new Set<string>();
      for (const c of manifest.capitulos ?? []) for (const t of c?.tags ?? []) if (tags.size < 6) tags.add(String(t));
      return {
        id,
        titulo: String(manifest.titulo || id),
        descripcion: String(manifest.descripcion || ''),
        nivel: manifest.nivel ? String(manifest.nivel) : undefined,
        version: manifest.version ? String(manifest.version) : undefined,
        tags: [...tags],
        archivos,
        baseUrl,
        webUrl: `${web}/tree/${ref}/${dir}`.replace(/\/$/, ''),
        resumen: summarizeCourse(manifest),
      };
    })
  );
  const cursos = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (dirs.length && !cursos.length) throw new Error(`No se pudo leer ningún curso.json de ${owner}/${repo}.`);
  return { nombre: `${owner}/${repo}`, webUrl: web, cursos: cursos.sort((a, b) => a.titulo.localeCompare(b.titulo)) };
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer ${url} (HTTP ${res.status}).`);
  return res.json();
}

/** Archivos que menciona un curso.json (cuando ni el catálogo ni el curso los listan). */
function filesFromManifest(manifest: any): string[] {
  const files = ['curso.json'];
  if (manifest.setup) files.push(manifest.setup);
  if (manifest.manual) files.push(manifest.manual);
  for (const c of manifest.capitulos || []) {
    if (c.archivo) files.push(c.archivo);
    for (const e of c.ejercicios || []) {
      if (e.enunciado) files.push(e.enunciado);
      if (e.solucion) files.push(e.solucion);
      if (e.pista) files.push(e.pista);
      for (const p of e.pistas || []) files.push(p);
      if (e.pruebas) files.push(e.pruebas);
      if (e.plantilla) files.push(e.plantilla);
    }
    // imágenes de las evaluaciones
    for (const q of c.evaluacion || []) {
      for (const it of [q, ...(q.zonas || []), ...(q.elementos || [])]) {
        if (it && typeof it.imagen === 'string' && !/^https?:/i.test(it.imagen)) files.push(it.imagen);
      }
    }
  }
  return files;
}

/** Descarga un curso del repositorio al folder de trabajo (store de `.tutor`). */
export async function downloadCourse(entry: RepoCourseEntry): Promise<string> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) throw new Error('Abre una carpeta de trabajo (workspace) para descargar el curso.');
  if (!entry.baseUrl || !/^https?:\/\//i.test(entry.baseUrl)) throw new Error('Curso sin dirección de descarga.');
  const courseBase = entry.baseUrl;
  const origin = entry.webUrl || getCatalogUrl() || `https://github.com/${getGithubRepo()}`;

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Descargando "${entry.titulo}"…` },
    async () => {
      const coursesDir = tutorState.coursesDir()!;
      const safeId = path.basename(String(entry.id));
      if (!safeId || safeId === '.' || safeId === '..') throw new Error('Id de curso inválido.');
      const target = path.join(coursesDir, safeId);

      // 1. Resolver lista de archivos: la del catálogo o la del manifest del curso
      let files = entry.archivos;
      if (!files || !files.length) {
        const manifestRes = await fetch(`${courseBase}curso.json`);
        if (!manifestRes.ok) {
          throw new Error(`No hay "archivos" en el catálogo ni curso.json en ${courseBase}`);
        }
        const manifest = (await manifestRes.json()) as any;
        files = manifest.archivos?.length
          ? ['curso.json', ...manifest.archivos, ...[manifest.setup, manifest.manual].filter(Boolean)]
          : filesFromManifest(manifest);
      }

      // 2. Descargar todos los archivos
      const fetchTo = async (rel: string, required: boolean): Promise<string | undefined> => {
        const dest = path.resolve(target, rel);
        // evita path traversal desde un catálogo malicioso (../../)
        if (dest === target || !dest.startsWith(target + path.sep)) {
          if (required) throw new Error(`Ruta no permitida en el catálogo: ${rel}`);
          return undefined;
        }
        const res = await fetch(`${courseBase}${rel.split('/').map(encodeURIComponent).join('/')}`);
        if (!res.ok) {
          if (required) throw new Error(`Fallo al descargar ${rel} (HTTP ${res.status}).`);
          return undefined;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        return dest;
      };
      fs.mkdirSync(target, { recursive: true });
      const done = new Set<string>();
      for (const rel of new Set(files)) {
        await fetchTo(rel, true);
        done.add(path.posix.normalize(rel));
      }

      // 3. Imágenes que la documentación usa y la lista no traía (se intentan; si faltan, no se aborta)
      for (const rel of done) {
        if (!rel.endsWith('.md')) continue;
        const text = fs.readFileSync(path.resolve(target, rel), 'utf8');
        for (const ref of markdownImageRefs(text)) {
          const img = path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref.split(/[?#]/)[0]));
          if (done.has(img) || img.startsWith('../')) continue;
          done.add(img);
          await fetchTo(img, false);
        }
      }
      tutorState.registerCourse(safeId, origin);
      return target;
    }
  );
}
