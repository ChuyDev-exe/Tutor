import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RepoCatalog, RepoCourseEntry } from './types';
import { tutorState } from './state';

export function getCatalogUrl(): string {
  return (
    vscode.workspace.getConfiguration('tutor').get<string>('repoCatalogUrl')?.trim() || ''
  );
}

export async function fetchCatalog(): Promise<RepoCatalog> {
  const url = getCatalogUrl();
  if (!url) {
    throw new Error(
      'Configura tutor.repoCatalogUrl con la URL del catalogo.json del repositorio de cursos.'
    );
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('tutor.repoCatalogUrl debe empezar con http:// o https://');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`No se pudo leer el catálogo (HTTP ${res.status}).`);
  const data = (await res.json()) as RepoCatalog;
  if (!Array.isArray(data.cursos)) throw new Error('El catálogo no tiene la lista "cursos".');
  return data;
}

function catalogBaseDir(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

/** Descarga un curso del repositorio al folder de trabajo (store de `.tutor`). */
export async function downloadCourse(entry: RepoCourseEntry): Promise<string> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) throw new Error('Abre una carpeta de trabajo (workspace) para descargar el curso.');

  const catalogUrl = getCatalogUrl();
  const base = catalogBaseDir(catalogUrl);
  const courseRuta = entry.ruta || `cursos/${entry.id}`;
  const courseBase = `${base}${courseRuta.replace(/\/+$/, '')}/`;

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
        files = manifest.archivos;
        if (!files || !files.length) {
          // reconstruir desde la estructura conocida de curso.json
          files = ['curso.json'];
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
          }
        } else {
          files = Array.from(
            new Set<string>(['curso.json', ...files, ...[manifest.setup, manifest.manual].filter(Boolean)])
          );
        }
      }

      // 2. Descargar todos los archivos
      fs.mkdirSync(target, { recursive: true });
      for (const rel of files) {
        const dest = path.resolve(target, rel);
        // evita path traversal desde un catálogo malicioso (../../)
        if (dest !== target && !dest.startsWith(target + path.sep)) {
          throw new Error(`Ruta no permitida en el catálogo: ${rel}`);
        }
        const res = await fetch(`${courseBase}${rel.split('/').map(encodeURIComponent).join('/')}`);
        if (!res.ok) throw new Error(`Fallo al descargar ${rel} (HTTP ${res.status}).`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      }
      tutorState.registerCourse(safeId, catalogUrl);
      return target;
    }
  );
}
