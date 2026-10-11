import * as fs from 'fs';
import * as path from 'path';
import { Course } from './types';
import { studentRoot } from './studentFolder';
import { tutorState } from './state';

export const THOUGHTS_NAME = 'pensamientos-pendientes.md';

export function thoughtsPath(course?: Course): string | undefined {
  const ws = tutorState.workspaceRoot();
  if (!ws) return undefined;
  return course ? path.join(studentRoot(course), THOUGHTS_NAME) : path.join(ws, THOUGHTS_NAME);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * «Estacionar» un pensamiento: apuntar lo que te distrajo (una idea, algo por hacer…) para
 * poder soltarlo y seguir con lo que estabas haciendo. Revísalo cuando termines la sesión.
 */
export function parkThought(course: Course | undefined, text: string, now = new Date()): string | undefined {
  const file = thoughtsPath(course);
  if (!file) return undefined;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      '# Pensamientos pendientes\n\nLo que te distrajo mientras estudiabas. Ya está anotado: suéltalo y revísalo cuando termines tu sesión.\n\n'
    );
  }
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const current = fs.readFileSync(file, 'utf8');
  const head = current.includes(`\n## ${day}\n`) ? '' : `## ${day}\n\n`;
  fs.appendFileSync(file, `${head}- [ ] ${pad(now.getHours())}:${pad(now.getMinutes())} — ${text.trim().replace(/\s*\n\s*/g, ' ')}\n`);
  return file;
}
