import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';

export interface QuizAttempt {
  fecha: string;
  score: number;
  total: number;
  aprobado: boolean;
}

export interface QuizRecord {
  mejor: { score: number; total: number };
  intentos: QuizAttempt[];
}

export interface FocusDay {
  minutos: number;
  sesiones: number;
  ejercicios: number;
}

export interface ExerciseRecord {
  pruebas?: { passed: number; total: number; fecha: string };
  ejecuciones: number;
  /** Cuántas pistas ha pedido el alumno. */
  pistas?: number;
}

/** Contenido del archivo `.tutor` (JSON), análogo al archivo `.git` de un worktree. */
export interface TutorFile {
  version: 2;
  /** Carpeta de datos (cursos instalados con soluciones y pruebas); fuera del workspace. */
  store: string;
  cursos: Record<string, { instalado: string; origen: string }>;
  progreso: Record<string, boolean>;
  evaluaciones: Record<string, QuizRecord>;
  ejercicios: Record<string, ExerciseRecord>;
  /** Días con actividad (YYYY-MM-DD) para calcular la racha. */
  actividad: string[];
  /** Cursos para los que el alumno autorizó ejecutar comandos de prueba definidos por el curso. */
  confiables?: Record<string, string[]>;
  /** Estadísticas de enfoque por día (YYYY-MM-DD). */
  enfoque: Record<string, FocusDay>;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Estado del tutor en el workspace.
 *   <workspace>/.tutor          → archivo JSON con progreso, evaluaciones y puntero `store`
 *   <store>/cursos/<id>/        → curso instalado (soluciones, pruebas, setup, manual)
 * `store` vive en el almacenamiento global de la extensión, así el workspace solo
 * contiene el archivo `.tutor` y la carpeta del alumno.
 */
export class TutorState {
  private context!: vscode.ExtensionContext;
  private data?: TutorFile;
  readonly onDidChange = new vscode.EventEmitter<void>();

  init(context: vscode.ExtensionContext): void {
    this.context = context;
    this.migrateLegacy();
  }

  workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  filePath(): string | undefined {
    const ws = this.workspaceRoot();
    return ws ? path.join(ws, '.tutor') : undefined;
  }

  private defaultStore(): string {
    const ws = this.workspaceRoot() ?? 'sin-workspace';
    const id = createHash('sha1').update(ws).digest('hex').slice(0, 12);
    return path.join(this.context.globalStorageUri.fsPath, 'workspaces', id);
  }

  private empty(): TutorFile {
    return {
      version: 2,
      store: this.defaultStore(),
      cursos: {},
      progreso: {},
      evaluaciones: {},
      ejercicios: {},
      actividad: [],
      enfoque: {},
    };
  }

  get(): TutorFile {
    if (this.data) return this.data;
    const file = this.filePath();
    let loaded: Partial<TutorFile> = {};
    try {
      if (file && fs.statSync(file).isFile()) loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* archivo ausente o corrupto: se parte de cero */
    }
    this.data = { ...this.empty(), ...loaded, version: 2 };
    return this.data;
  }

  /** Vuelve a leer `.tutor` desde disco (p. ej. tras editarlo a mano o hacer git pull). */
  reloadFromDisk(): void {
    this.data = undefined;
    this.onDidChange.fire();
  }

  save(): void {
    const file = this.filePath();
    if (!file) return;
    try {
      fs.writeFileSync(file, JSON.stringify(this.get(), null, 2) + '\n');
    } catch (err) {
      vscode.window.showWarningMessage(
        `Tutor: no se pudo guardar .tutor (${err instanceof Error ? err.message : err})`
      );
    }
    this.onDidChange.fire();
  }

  storeDir(): string {
    const dir = this.get().store || this.defaultStore();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Dónde viven los cursos instalados. Undefined si no hay workspace abierto. */
  coursesDir(): string | undefined {
    if (!this.workspaceRoot()) return undefined;
    const dir = path.join(this.storeDir(), 'cursos');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  registerCourse(id: string, origen: string): void {
    this.get().cursos[id] = { instalado: new Date().toISOString(), origen };
    this.touch();
  }

  touch(): void {
    const d = this.get();
    const t = today();
    if (!d.actividad.includes(t)) d.actividad.push(t);
    d.actividad = d.actividad.slice(-400);
    this.save();
  }

  focusToday(): FocusDay {
    return this.get().enfoque[today()] ?? { minutos: 0, sesiones: 0, ejercicios: 0 };
  }

  /** Suma al contador de enfoque de hoy. */
  addFocus(delta: Partial<FocusDay>): void {
    const d = this.get();
    const cur = d.enfoque[today()] ?? { minutos: 0, sesiones: 0, ejercicios: 0 };
    d.enfoque[today()] = {
      minutos: cur.minutos + (delta.minutos ?? 0),
      sesiones: cur.sesiones + (delta.sesiones ?? 0),
      ejercicios: cur.ejercicios + (delta.ejercicios ?? 0),
    };
    // se conservan solo los últimos 90 días
    const keys = Object.keys(d.enfoque).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete d.enfoque[k];
    this.touch();
  }

  streak(): number {
    const days = new Set(this.get().actividad);
    let n = 0;
    const d = new Date();
    if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); // hoy aún cuenta
    while (days.has(d.toISOString().slice(0, 10))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /** Borra progreso, evaluaciones y resultados (los cursos instalados se conservan). */
  resetProgress(courseId?: string): void {
    const d = this.get();
    const keep = <T>(rec: Record<string, T>): Record<string, T> =>
      courseId ? Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith(courseId + '/'))) : {};
    d.progreso = keep(d.progreso);
    d.evaluaciones = keep(d.evaluaciones);
    d.ejercicios = keep(d.ejercicios);
    if (!courseId) d.enfoque = {};
    this.save();
  }

  /** Migra el formato anterior, donde `.tutor` era una carpeta. */
  private migrateLegacy(): void {
    const file = this.filePath();
    if (!file) return;
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isDirectory()) return;
      const legacy = file;
      const data = this.empty();
      const oldCourses = path.join(legacy, 'cursos');
      if (fs.existsSync(oldCourses)) {
        const dest = path.join(data.store, 'cursos');
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(oldCourses, dest, { recursive: true });
        for (const id of fs.readdirSync(oldCourses)) {
          data.cursos[id] = { instalado: new Date().toISOString(), origen: 'migrado' };
        }
      }
      const prog = path.join(legacy, 'progreso.json');
      if (fs.existsSync(prog)) {
        const old = JSON.parse(fs.readFileSync(prog, 'utf8'));
        data.progreso = old.progress ?? {};
        for (const [k, v] of Object.entries<any>(old.quizScores ?? {})) {
          data.evaluaciones[k] = { mejor: v, intentos: [] };
        }
      }
      fs.renameSync(legacy, legacy + '.bak');
      this.data = data;
      this.save();
      vscode.window.showInformationMessage(
        'Tutor: la carpeta «.tutor» se migró al nuevo formato (archivo «.tutor»). La anterior quedó como «.tutor.bak».'
      );
    } catch {
      /* si falla la migración no se bloquea la extensión */
    }
  }
}

export const tutorState = new TutorState();
