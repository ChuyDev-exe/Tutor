import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Chapter, Course, Exercise } from './types';
import { parseNpmDeps, parseQuiz } from './pure';

import { tutorState } from './state';

function isCourseDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'curso.json'));
  } catch {
    return false;
  }
}

function resolveContentRoots(): { dir: string; source: Course['source'] }[] {
  const roots: { dir: string; source: Course['source'] }[] = [];
  const cfg = vscode.workspace.getConfiguration('tutor');

  // 1. Cursos descargados en el workspace
  const wsDir = tutorState.coursesDir();
  if (wsDir && fs.existsSync(wsDir)) {
    for (const name of fs.readdirSync(wsDir)) {
      const dir = path.join(wsDir, name);
      if (isCourseDir(dir)) {
        roots.push({ dir, source: 'descargado' });
      }
    }
  }

  // 2. Carpeta extra de contenido local
  const extra = cfg.get<string>('contentPath') || '';
  if (extra) {
    let extraDir = extra;
    if (!path.isAbsolute(extra) && vscode.workspace.workspaceFolders?.length) {
      extraDir = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, extra);
    }
    if (fs.existsSync(extraDir)) {
      if (fs.existsSync(path.join(extraDir, 'curso.json'))) {
        roots.push({ dir: extraDir, source: 'local' });
      } else {
        for (const name of fs.readdirSync(extraDir)) {
          const dir = path.join(extraDir, name);
          if (isCourseDir(dir)) {
            roots.push({ dir, source: 'local' });
          }
        }
      }
    }
  }

  return roots;
}

/** Imagen de una pregunta: URL https o archivo existente dentro del curso (si no, se ignora). */
function quizAsset(dir: string, rel: string): string | undefined {
  if (/^https:\/\//i.test(rel)) return rel;
  const root = path.resolve(dir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) return undefined;
  return abs;
}

function loadCourse(dir: string, source: Course['source']): Course | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'curso.json'), 'utf8'));
    const capitulos: Chapter[] = [];
    for (const c of raw.capitulos || []) {
      const ejercicios: Exercise[] = (c.ejercicios || []).map((e: any) => ({
        id: e.id,
        titulo: e.titulo,
        enunciadoFile: path.join(dir, e.enunciado),
        solucionFile: e.solucion ? path.join(dir, e.solucion) : '',
        pistaFile: e.pista ? path.join(dir, e.pista) : Array.isArray(e.pistas) && e.pistas[0] ? path.join(dir, e.pistas[0]) : undefined,
        pistaFiles: (Array.isArray(e.pistas) ? e.pistas : e.pista ? [e.pista] : []).map((p: string) => path.join(dir, p)),
        lenguaje: e.lenguaje ? String(e.lenguaje) : undefined,
        pruebas: e.pruebas ? path.join(dir, e.pruebas) : undefined,
        pruebasComando: e.pruebasComando ? String(e.pruebasComando) : undefined,
        plantillaFile: e.plantilla ? path.join(dir, e.plantilla) : undefined,
      }));
      const evaluacion = parseQuiz(c.evaluacion, (rel) => quizAsset(dir, rel));
      capitulos.push({
        id: c.id,
        titulo: c.titulo,
        descripcion: c.descripcion || '',
        archivo: path.join(dir, c.archivo),
        tags: c.tags || [],
        ejercicios,
        evaluacion: evaluacion.length ? evaluacion : undefined,
        aprobacion: Math.min(100, Math.max(1, Number(c.aprobacion) || 70)),
        evaluacionRequerida: c.evaluacionRequerida === true,
        barajar: c.barajar !== false,
        minutos: Number(c.minutos) > 0 ? Number(c.minutos) : undefined,
      });
    }
    return {
      id: raw.id || path.basename(dir),
      titulo: raw.titulo || path.basename(dir),
      descripcion: raw.descripcion || '',
      nivel: raw.nivel || '',
      root: dir,
      capitulos,
      source,
      version: raw.version ? String(raw.version) : undefined,
      requisitos: Array.isArray(raw.requisitos)
        ? raw.requisitos.filter((r: any) => r && typeof r.comando === 'string' && r.comando.trim())
        : [],
      setupFile: raw.setup ? path.join(dir, String(raw.setup)) : undefined,
      manualFile: raw.manual ? path.join(dir, String(raw.manual)) : undefined,
      npm: parseNpmDeps(raw.dependencias?.npm),
    };
  } catch {
    return undefined;
  }
}

export function loadCourses(context: vscode.ExtensionContext): Course[] {
  const courses: Course[] = [];
  const seen = new Set<string>();
  for (const root of resolveContentRoots()) {
    const course = loadCourse(root.dir, root.source);
    if (course && !seen.has(course.id)) {
      seen.add(course.id);
      courses.push(course);
    }
  }
  return courses;
}

export function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export interface SearchResult {
  kind: 'chapter' | 'exercise';
  course: Course;
  chapter: Chapter;
  exercise?: Exercise;
  snippet: string;
}

export function searchLocal(query: string, courses: Course[]): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results: SearchResult[] = [];
  for (const course of courses) {
    for (const ch of course.capitulos) {
      const body = readText(ch.archivo);
      const chHay = `${ch.titulo} ${ch.descripcion} ${ch.tags.join(' ')}`.toLowerCase();
      if (chHay.includes(q) || body.toLowerCase().includes(q)) {
        results.push({
          kind: 'chapter',
          course,
          chapter: ch,
          snippet: snippetFor(body, q, ch.descripcion),
        });
      }
      for (const ex of ch.ejercicios) {
        const enun = readText(ex.enunciadoFile);
        const exHay = `${ex.titulo}`.toLowerCase();
        if (exHay.includes(q) || enun.toLowerCase().includes(q)) {
          results.push({
            kind: 'exercise',
            course,
            chapter: ch,
            exercise: ex,
            snippet: snippetFor(enun, q, `Ejercicio de ${ch.titulo}`),
          });
        }
      }
    }
  }
  return results;
}

function snippetFor(text: string, q: string, fallback: string): string {
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return fallback;
  const start = Math.max(0, idx - 60);
  return '…' + text.slice(start, idx + 160).replace(/\n+/g, ' ') + '…';
}
