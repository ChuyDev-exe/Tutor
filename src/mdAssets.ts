import * as fs from 'fs';
import * as path from 'path';
import { rewriteMarkdownImages } from './pure';

/**
 * Imágenes de la documentación de un curso (sin dependencias de VS Code).
 *
 * Los Markdown del curso viven en el almacén de la extensión y se copian a otra carpeta
 * (la del alumno, o una vista de la solución). Sus imágenes relativas dejarían de resolverse,
 * así que se copian a `assetsDir` conservando su ruta dentro del curso y se reescriben los enlaces.
 */

const inside = (root: string, p: string): boolean => p === root || p.startsWith(root + path.sep);

const toUrlPath = (rel: string): string => rel.split(path.sep).map(encodeURIComponent).join('/');

/**
 * Devuelve `text` (un Markdown que estaba en `srcDir`) listo para guardarse en `destDir`:
 * copia cada imagen local del curso a `assetsDir` y apunta el enlace a la copia.
 * Las imágenes fuera del curso o inexistentes se dejan tal cual.
 */
export function withCourseImages(text: string, srcDir: string, destDir: string, courseRoot: string, assetsDir: string): string {
  const root = path.resolve(courseRoot);
  return rewriteMarkdownImages(text, (ref) => {
    const abs = path.resolve(srcDir, ref.split(/[?#]/)[0]);
    if (!inside(root, abs) || !isFile(abs)) return undefined;
    const copy = path.join(assetsDir, path.relative(root, abs));
    copyIfChanged(abs, copy);
    return toUrlPath(path.relative(destDir, copy));
  });
}

/** Copia un Markdown del curso a `dest` con sus imágenes. */
export function copyMarkdown(src: string, dest: string, courseRoot: string, assetsDir: string): void {
  const text = withCourseImages(fs.readFileSync(src, 'utf8'), path.dirname(src), path.dirname(dest), courseRoot, assetsDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function copyIfChanged(src: string, dest: string): void {
  try {
    const a = fs.statSync(src);
    const b = fs.statSync(dest);
    if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return;
  } catch {
    /* no existe todavía */
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
