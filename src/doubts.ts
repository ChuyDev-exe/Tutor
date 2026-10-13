import * as fs from 'fs';
import * as path from 'path';
import { Chapter, Course, Exercise } from './types';
import { studentRoot } from './studentFolder';
import { tutorState } from './state';
import { DoubtEntry, flattenHeadings, parseDoubts } from './pure';

export const DOUBTS_NAME = 'dudas-y-preguntas.md';

/** Archivo de dudas: en la carpeta del alumno del curso; sin curso activo, en la raíz del workspace. */
export function doubtsPath(course?: Course): string | undefined {
  const ws = tutorState.workspaceRoot();
  if (!ws) return undefined;
  return course ? path.join(studentRoot(course), DOUBTS_NAME) : path.join(ws, DOUBTS_NAME);
}

const pad = (n: number): string => String(n).padStart(2, '0');

const listeners = new Set<(course?: Course) => void>();

/** Avisa cada vez que se guarda una duda (la vista «Dudas» se refresca). */
export function onDoubtSaved(fn: (course?: Course) => void): { dispose(): void } {
  listeners.add(fn);
  return { dispose: () => listeners.delete(fn) };
}

export function ensureDoubtsFile(course?: Course): string | undefined {
  const file = doubtsPath(course);
  if (!file) return undefined;
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `# Mis dudas y preguntas${course ? ` — ${course.titulo}` : ''}\n\n` +
        'Aquí se guardan, en orden, tus preguntas al tutor y sus respuestas, para que las tengas a la mano. ' +
        'Puedes buscar con Ctrl/Cmd+F o añadir tus propias notas.\n\n'
    );
  }
  return file;
}

/** Añade una pregunta con su respuesta. Devuelve la ruta del archivo. */
export function saveDoubt(
  course: Course | undefined,
  chapter: Chapter | undefined,
  exercise: Exercise | undefined,
  question: string,
  answer: string,
  now = new Date()
): string | undefined {
  const file = ensureDoubtsFile(course);
  if (!file) return undefined;
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const where = [chapter?.titulo, exercise?.titulo].filter(Boolean).join(' › ') || 'General';
  const [first, ...rest] = question.trim().split('\n');
  const body = rest.join('\n').trim();

  const current = fs.readFileSync(file, 'utf8');
  let entry = current.includes(`\n## ${day}\n`) ? '' : `## ${day}\n\n`;
  entry +=
    `### ${time} · ${where}\n\n**Pregunta:** ${first.trim()}\n` +
    (body ? `\n${body.split('\n').map((l) => `> ${l}`).join('\n')}\n` : '') +
    `\n**Respuesta del tutor:**\n\n${flattenHeadings(answer.trim())}\n\n---\n\n`;
  fs.appendFileSync(file, entry);
  listeners.forEach((fn) => fn(course));
  return file;
}

/** Dudas guardadas de un curso (sin curso: las generales del workspace), en orden de guardado. */
export function listDoubts(course: Course | undefined): DoubtEntry[] {
  const file = doubtsPath(course);
  if (!file || !fs.existsSync(file)) return [];
  return parseDoubts(fs.readFileSync(file, 'utf8'));
}

/** Últimas preguntas guardadas (para que el tutor pueda enlazar con dudas anteriores). */
export function recentQuestions(course: Course | undefined, n = 10): string[] {
  return listDoubts(course)
    .slice(-n)
    .map((d) => d.pregunta.slice(0, 140));
}
