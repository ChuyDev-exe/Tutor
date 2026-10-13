import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Chapter, Course, Exercise } from './types';
import { runtimeFor } from './runtimes';
import { slug } from './pure';
import { copyMarkdown, withCourseImages } from './mdAssets';

/**
 * Dos carpetas por curso en el workspace:
 *  - archivo `.tutor`     → seguimiento (progreso, evaluaciones) y puntero al `store` con los cursos instalados.
 *  - `<id-del-curso>/`    → carpeta del alumno: manuales desbloqueados y archivos a editar.
 */

export { slug };

function workspaceRoot(): string {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) throw new Error('Abre una carpeta de workspace: ahí se crea la carpeta del alumno.');
  return ws.uri.fsPath;
}

/** Nombre de carpeta seguro derivado de un id de curso (nunca '.', '..' ni separadores). */
export const safeName = (id: string): string => id.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'curso';

export function studentRoot(course: Course): string {
  return path.join(workspaceRoot(), safeName(course.id));
}

/** Imágenes de la documentación del curso, copiadas para que los Markdown del alumno las muestren. */
export function assetsDir(course: Course): string {
  return path.join(studentRoot(course), 'imagenes');
}

export function chapterDir(course: Course, chapter: Chapter): string {
  const i = Math.max(0, course.capitulos.findIndex((c) => c.id === chapter.id));
  return path.join(studentRoot(course), `${String(i + 1).padStart(2, '0')}-${slug(chapter.titulo)}`);
}

export function manualFileFor(course: Course, chapter: Chapter): string {
  return path.join(chapterDir(course, chapter), 'manual.md');
}

export function exerciseFile(course: Course, chapter: Chapter, ex: Exercise): string {
  const ext = runtimeFor(ex.lenguaje)?.ext ?? '.txt';
  let name = slug(ex.titulo);
  if (chapter.ejercicios.some((o) => o.id !== ex.id && slug(o.titulo) === name)) name += `-${slug(ex.id)}`;
  return path.join(chapterDir(course, chapter), name + ext);
}

/** Enunciado del ejercicio como .md junto al archivo del alumno (misma base de nombre). */
export function statementFile(course: Course, chapter: Chapter, ex: Exercise): string {
  const f = exerciseFile(course, chapter, ex);
  return f.slice(0, f.length - path.extname(f).length) + '.md';
}

export function ensureStatement(course: Course, chapter: Chapter, ex: Exercise): string {
  const file = statementFile(course, chapter, ex);
  if (fs.existsSync(ex.enunciadoFile)) copyMarkdown(ex.enunciadoFile, file, course.root, assetsDir(course));
  return file;
}

function write(file: string, content: string, overwrite: boolean): void {
  if (!overwrite && fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function template(ex: Exercise, ext: string): string {
  if (ex.plantillaFile && fs.existsSync(ex.plantillaFile)) return fs.readFileSync(ex.plantillaFile, 'utf8');
  const c = ext === '.py' || ext === '.sh' ? '#' : '//';
  return `${c} ${ex.titulo}\n${c} Escribe aquí tu solución. El enunciado está en la vista del ejercicio.\n${c} Usa la barra de estado: «Ejecutar código» y «Ejecutar pruebas».\n\n`;
}

/** Crea el archivo editable del ejercicio si no existe (nunca pisa el trabajo del alumno). */
export function ensureExerciseFile(course: Course, chapter: Chapter, ex: Exercise): string {
  const file = exerciseFile(course, chapter, ex);
  write(file, template(ex, path.extname(file)), false);
  return file;
}

/** Copia/actualiza el manual del capítulo en la carpeta del alumno. */
export function ensureChapterManual(course: Course, chapter: Chapter): string {
  const file = manualFileFor(course, chapter);
  if (fs.existsSync(chapter.archivo)) copyMarkdown(chapter.archivo, file, course.root, assetsDir(course));
  return file;
}

/**
 * Materializa la carpeta del alumno: solo capítulos desbloqueados reciben su manual
 * y los archivos de sus ejercicios. Los bloqueados no existen en disco.
 */
export function syncStudentFolder(course: Course, isUnlocked: (index: number) => boolean): string {
  const root = studentRoot(course);
  fs.mkdirSync(root, { recursive: true });
  if (course.manualFile && fs.existsSync(course.manualFile)) {
    copyMarkdown(course.manualFile, path.join(root, 'MANUAL.md'), course.root, assetsDir(course));
  }
  course.capitulos.forEach((ch, i) => {
    if (!isUnlocked(i)) return;
    ensureChapterManual(course, ch);
    for (const ex of ch.ejercicios) {
      ensureExerciseFile(course, ch, ex);
      ensureStatement(course, ch, ex);
    }
  });
  return root;
}

/** Restaura el archivo del alumno a la plantilla; deja una copia `.bak` de lo que había. */
export function resetExerciseFile(course: Course, chapter: Chapter, ex: Exercise): string {
  const file = exerciseFile(course, chapter, ex);
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  write(file, template(ex, path.extname(file)), true);
  return file;
}

/** Archivo con las pistas ya reveladas (`<ejercicio>-pistas.md`), acumulativo. */
export function hintsFile(course: Course, chapter: Chapter, ex: Exercise): string {
  const f = exerciseFile(course, chapter, ex);
  return f.slice(0, f.length - path.extname(f).length) + '-pistas.md';
}

export function writeHints(course: Course, chapter: Chapter, ex: Exercise, count: number): string {
  const file = hintsFile(course, chapter, ex);
  const parts = ex.pistaFiles.slice(0, count).map((p, i) => {
    const body = fs.existsSync(p)
      ? withCourseImages(fs.readFileSync(p, 'utf8').trim(), path.dirname(p), path.dirname(file), course.root, assetsDir(course))
      : '_(pista no disponible)_';
    return `## Pista ${i + 1} de ${ex.pistaFiles.length}\n\n${body}`;
  });
  write(file, `# Pistas: ${ex.titulo}\n\nSe revelan de una en una; intenta avanzar entre pista y pista.\n\n${parts.join('\n\n')}\n`, true);
  return file;
}
