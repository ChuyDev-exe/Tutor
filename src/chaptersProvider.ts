import * as vscode from 'vscode';
import { Chapter, Course, Exercise } from './types';
import { loadCourses } from './content';
import { focusMode, noEmojis, stripEmoji, ui } from './a11y';
import { QuizAttempt, QuizRecord, tutorState } from './state';

export type ChapterNode = NextStepItem | CourseItem | ChapterItem | ExerciseItem;

export interface NextStep {
  course: Course;
  chapter: Chapter;
  kind: 'manual' | 'exercise' | 'quiz' | 'complete';
  exercise?: Exercise;
  label: string;
  done: number;
  total: number;
}

export interface ProgressEvent {
  kind: 'chapter' | 'exercise' | 'quiz';
  courseId: string;
  chapterId: string;
  exerciseId?: string;
  done: boolean;
}

export const exKey = (chapterId: string, exerciseId: string): string => `${chapterId}/${exerciseId}`;

export function quizPassed(chapter: Chapter, best?: { score: number; total: number }): boolean {
  return !!best && best.total > 0 && (best.score / best.total) * 100 >= chapter.aprobacion;
}

export class ChaptersProvider implements vscode.TreeDataProvider<ChapterNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ChapterNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _onDidChangeProgress = new vscode.EventEmitter<ProgressEvent>();
  readonly onDidChangeProgress = this._onDidChangeProgress.event;

  private _onDidChangeQuiz = new vscode.EventEmitter<void>();
  readonly onDidChangeQuiz = this._onDidChangeQuiz.event;

  private courses: Course[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.reload();
  }

  reload(): void {
    tutorState.reloadFromDisk();
    this.courses = loadCourses(this.context);
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshTree(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  get allCourses(): Course[] {
    return this.courses;
  }

  // ── Árbol ───────────────────────────────────────────────────────────
  getTreeItem(node: ChapterNode): vscode.TreeItem {
    if (noEmojis()) {
      if (typeof node.label === 'string') node.label = stripEmoji(node.label);
      if (typeof node.description === 'string') node.description = stripEmoji(node.description);
    }
    return node;
  }

  // ── Guía paso a paso ────────────────────────────────────────────────
  isManualRead(courseId: string, chapterId: string): boolean {
    return !!tutorState.get().progreso[`${courseId}/${chapterId}#leido`];
  }

  markManualRead(courseId: string, chapterId: string): void {
    if (this.isManualRead(courseId, chapterId)) return;
    tutorState.get().progreso[`${courseId}/${chapterId}#leido`] = true;
    tutorState.touch();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** El siguiente paso concreto del curso: leer → ejercicios → evaluación → completar. */
  nextStep(course: Course): NextStep | undefined {
    for (let i = 0; i < course.capitulos.length; i++) {
      const ch = course.capitulos[i];
      if (this.isDone(course.id, ch.id) || !this.isChapterUnlocked(course.id, i)) continue;
      const hasQuiz = !!ch.evaluacion?.length;
      const total = 1 + ch.ejercicios.length + (hasQuiz ? 1 : 0);
      const read = this.isManualRead(course.id, ch.id);
      const pending = ch.ejercicios.filter((e) => !this.isDone(course.id, exKey(ch.id, e.id)));
      const quizOk = !hasQuiz || quizPassed(ch, this.getQuizScore(course.id, ch.id));
      const done = (read ? 1 : 0) + (ch.ejercicios.length - pending.length) + (hasQuiz && quizOk ? 1 : 0);
      const base = { course, chapter: ch, done, total };
      if (!read) return { ...base, kind: 'manual', label: `Leer «${ch.titulo}»` };
      if (pending.length) return { ...base, kind: 'exercise', exercise: pending[0], label: `Ejercicio: ${pending[0].titulo}` };
      if (!quizOk) return { ...base, kind: 'quiz', label: `Evaluación de «${ch.titulo}»` };
      return { ...base, kind: 'complete', label: `Marcar «${ch.titulo}» como completo` };
    }
    return undefined;
  }

  getChildren(element?: ChapterNode): ChapterNode[] {
    if (!element) {
      const expanded =
        this.courses.length === 1
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      const nodes: ChapterNode[] = [];
      for (const c of this.courses) {
        const step = this.nextStep(c);
        if (step) {
          nodes.push(new NextStepItem(step));
          break; // una sola sugerencia a la vez: menos carga de decisión
        }
      }
      return nodes.concat(this.courses.map((c) => new CourseItem(c, this.summary(c), expanded)));
    }
    if (element instanceof CourseItem) {
      const focus = focusMode();
      const current = this.nextStep(element.course)?.chapter.id;
      const items = element.course.capitulos.map(
        (ch, i) =>
          new ChapterItem(
            element.course,
            ch,
            this.isDone(element.course.id, ch.id),
            !this.isChapterUnlocked(element.course.id, i),
            this.chapterProgress(element.course, ch),
            ch.id === current,
            { passed: quizPassed(ch, this.getQuizScore(element.course.id, ch.id)), tried: !!this.getQuiz(element.course.id, ch.id) }
          )
      );
      // modo enfoque: solo lo ya hecho y lo actual; lo bloqueado se oculta
      return focus ? items.filter((it) => !it.locked) : items;
    }
    if (element instanceof ChapterItem) {
      if (element.locked) return [];
      const { course, chapter } = element;
      // un nodo por ejercicio y nada más (manual: clic en el capítulo; evaluación: botón del capítulo)
      return chapter.ejercicios.map(
        (ex) =>
          new ExerciseItem(
            course,
            chapter,
            ex,
            this.isDone(course.id, exKey(chapter.id, ex.id)),
            this.exerciseRecord(course.id, chapter.id, ex.id)?.pruebas
          )
      );
    }
    return [];
  }

  // ── Progreso ────────────────────────────────────────────────────────
  isDone(courseId: string, relId: string): boolean {
    return !!tutorState.get().progreso[`${courseId}/${relId}`];
  }

  /** Un capítulo se desbloquea cuando el anterior está completado (el primero siempre). */
  isChapterUnlocked(courseId: string, index: number): boolean {
    if (index <= 0) return true;
    const prev = this.courses.find((c) => c.id === courseId)?.capitulos[index - 1];
    return !!prev && this.isDone(courseId, prev.id);
  }

  exerciseRecord(courseId: string, chapterId: string, exerciseId: string) {
    return tutorState.get().ejercicios[`${courseId}/${exKey(chapterId, exerciseId)}`];
  }

  /** Motivo por el que el capítulo aún no puede completarse, o undefined si ya puede. */
  canCompleteChapter(course: Course, chapter: Chapter): string | undefined {
    const pending = chapter.ejercicios.filter((e) => !this.isDone(course.id, exKey(chapter.id, e.id)));
    if (pending.length) {
      return `Te falta${pending.length > 1 ? 'n' : ''} ${pending.length} ejercicio(s): ${pending.map((e) => e.titulo).join(', ')}.`;
    }
    if (chapter.evaluacion?.length && chapter.evaluacionRequerida) {
      if (!quizPassed(chapter, this.getQuiz(course.id, chapter.id)?.mejor)) {
        return `Debes aprobar la evaluación (≥ ${chapter.aprobacion}%).`;
      }
    }
    return undefined;
  }

  async setChapterDone(courseId: string, chapterId: string, done: boolean): Promise<boolean> {
    const course = this.courses.find((c) => c.id === courseId);
    const chapter = course?.capitulos.find((ch) => ch.id === chapterId);
    if (done && course && chapter) {
      const reason = this.canCompleteChapter(course, chapter);
      if (reason) {
        vscode.window.showWarningMessage(`Tutor: no puedes completar «${chapter.titulo}». ${reason}`);
        this._onDidChangeTreeData.fire(undefined); // desmarca el checkbox
        return false;
      }
    }
    tutorState.get().progreso[`${courseId}/${chapterId}`] = done;
    tutorState.touch();
    this._onDidChangeProgress.fire({ kind: 'chapter', courseId, chapterId, done });
    this._onDidChangeTreeData.fire(undefined);
    return true;
  }

  async setExerciseDone(courseId: string, chapterId: string, exerciseId: string, done: boolean): Promise<void> {
    const p = tutorState.get().progreso;
    const was = !!p[`${courseId}/${exKey(chapterId, exerciseId)}`];
    p[`${courseId}/${exKey(chapterId, exerciseId)}`] = done;
    if (done && !was) tutorState.addFocus({ ejercicios: 1 });
    if (!done) p[`${courseId}/${chapterId}`] = false; // desmarcar un ejercicio reabre el capítulo
    tutorState.touch();
    this._onDidChangeProgress.fire({ kind: 'exercise', courseId, chapterId, exerciseId, done });
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Completa el capítulo automáticamente si ya cumple todo. Devuelve true si lo completó. */
  async tryAutoComplete(course: Course, chapter: Chapter): Promise<boolean> {
    if (this.isDone(course.id, chapter.id)) return false;
    if (!chapter.ejercicios.length && !chapter.evaluacion?.length) return false;
    if (this.canCompleteChapter(course, chapter)) return false;
    return this.setChapterDone(course.id, chapter.id, true);
  }

  async toggleFromTree(node: ChapterNode, done: boolean): Promise<void> {
    if (node instanceof ChapterItem) {
      if (node.locked) return;
      await this.setChapterDone(node.course.id, node.chapter.id, done);
    }
  }

  hintsShown(courseId: string, chapterId: string, exerciseId: string): number {
    return this.exerciseRecord(courseId, chapterId, exerciseId)?.pistas ?? 0;
  }

  /** Revela la siguiente pista (hasta `total`). Devuelve cuántas quedan visibles. */
  revealHint(courseId: string, chapterId: string, exerciseId: string, total: number): number {
    const all = tutorState.get().ejercicios;
    const key = `${courseId}/${exKey(chapterId, exerciseId)}`;
    const rec = all[key] ?? { ejecuciones: 0 };
    rec.pistas = Math.min(total, (rec.pistas ?? 0) + 1);
    all[key] = rec;
    tutorState.touch();
    return rec.pistas;
  }

  recordExercise(courseId: string, chapterId: string, exerciseId: string, patch: { run?: boolean; passed?: number; total?: number }): void {
    const all = tutorState.get().ejercicios;
    const key = `${courseId}/${exKey(chapterId, exerciseId)}`;
    const rec = all[key] ?? { ejecuciones: 0 };
    if (patch.run) rec.ejecuciones++;
    if (patch.total !== undefined) {
      rec.pruebas = { passed: patch.passed ?? 0, total: patch.total, fecha: new Date().toISOString() };
    }
    all[key] = rec;
    tutorState.touch();
    this._onDidChangeTreeData.fire(undefined);
  }

  // ── Evaluaciones ────────────────────────────────────────────────────
  getQuiz(courseId: string, chapterId: string): QuizRecord | undefined {
    return tutorState.get().evaluaciones[`${courseId}/${chapterId}`];
  }

  getQuizScore(courseId: string, chapterId: string): { score: number; total: number } | undefined {
    return this.getQuiz(courseId, chapterId)?.mejor;
  }

  recordQuizAttempt(course: Course, chapter: Chapter, score: number, total: number): QuizRecord {
    const evals = tutorState.get().evaluaciones;
    const key = `${course.id}/${chapter.id}`;
    const attempt: QuizAttempt = {
      fecha: new Date().toISOString(),
      score,
      total,
      aprobado: quizPassed(chapter, { score, total }),
    };
    const prev = evals[key];
    const better = !prev || score / total > prev.mejor.score / prev.mejor.total;
    evals[key] = {
      mejor: better ? { score, total } : prev.mejor,
      intentos: [...(prev?.intentos ?? []), attempt].slice(-20),
    };
    tutorState.touch();
    this._onDidChangeQuiz.fire();
    this._onDidChangeProgress.fire({ kind: 'quiz', courseId: course.id, chapterId: chapter.id, done: attempt.aprobado });
    this._onDidChangeTreeData.fire(undefined);
    return evals[key];
  }

  async reset(courseId?: string): Promise<void> {
    tutorState.resetProgress(courseId);
    this._onDidChangeQuiz.fire();
    this._onDidChangeTreeData.fire(undefined);
  }

  // ── Resúmenes ───────────────────────────────────────────────────────
  summary(course: Course): { done: number; total: number } {
    let done = 0;
    let total = 0;
    for (const ch of course.capitulos) {
      total++;
      if (this.isDone(course.id, ch.id)) done++;
      for (const ex of ch.ejercicios) {
        total++;
        if (this.isDone(course.id, exKey(ch.id, ex.id))) done++;
      }
      if (ch.evaluacion?.length) {
        total++;
        if (quizPassed(ch, this.getQuizScore(course.id, ch.id))) done++;
      }
    }
    return { done, total };
  }

  percent(course: Course): number {
    const s = this.summary(course);
    return s.total ? Math.round((s.done / s.total) * 100) : 0;
  }

  overallPercent(): number | undefined {
    if (!this.courses.length) return undefined;
    let done = 0;
    let total = 0;
    for (const c of this.courses) {
      const s = this.summary(c);
      done += s.done;
      total += s.total;
    }
    return total ? Math.round((done / total) * 100) : 0;
  }

  chapterProgress(course: Course, ch: Chapter): { done: number; total: number } {
    const exDone = ch.ejercicios.filter((e) => this.isDone(course.id, exKey(ch.id, e.id))).length;
    const hasQuiz = !!ch.evaluacion?.length;
    return {
      done: exDone + (hasQuiz && quizPassed(ch, this.getQuizScore(course.id, ch.id)) ? 1 : 0),
      total: ch.ejercicios.length + (hasQuiz ? 1 : 0),
    };
  }
}

// ── Nodos ─────────────────────────────────────────────────────────────
const GREEN = new vscode.ThemeColor('testing.iconPassed');
const RED = new vscode.ThemeColor('testing.iconFailed');
const BLUE = new vscode.ThemeColor('charts.blue');
const YELLOW = new vscode.ThemeColor('testing.iconQueued');
const DIM = new vscode.ThemeColor('disabledForeground');

export class CourseItem extends vscode.TreeItem {
  constructor(
    public readonly course: Course,
    summary: { done: number; total: number },
    expanded: vscode.TreeItemCollapsibleState
  ) {
    super(course.titulo, expanded);
    const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
    this.id = `course:${course.id}`;
    this.description = pct === 100 ? '' : `${pct}%`;
    this.tooltip = new vscode.MarkdownString(
      `**${course.titulo}** ${course.nivel ? `· ${course.nivel}` : ''}\n\n${course.descripcion}\n\n` +
        `Avance: **${summary.done}/${summary.total}** (${pct}%) · ${course.capitulos.length} capítulos` +
        (course.requisitos.length ? `\n\nRequisitos: ${course.requisitos.map((r) => r.nombre || r.comando).join(', ')}` : '')
    );
    this.iconPath = new vscode.ThemeIcon(pct === 100 ? 'verified-filled' : 'mortar-board', pct === 100 ? GREEN : undefined);
    this.contextValue = 'tutorCourse' + (course.setupFile ? 'Setup' : '') + (course.manualFile ? 'Manual' : '');
  }
}

export class ChapterItem extends vscode.TreeItem {
  constructor(
    public readonly course: Course,
    public readonly chapter: Chapter,
    done: boolean,
    public readonly locked = false,
    progress?: { done: number; total: number },
    expand = false,
    quiz?: { passed: boolean; tried: boolean }
  ) {
    super(
      chapter.titulo,
      locked
        ? vscode.TreeItemCollapsibleState.None
        : expand
          ? vscode.TreeItemCollapsibleState.Expanded
          : chapter.ejercicios.length
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
    );
    this.id = `chapter:${course.id}:${chapter.id}`;
    this.description = !locked && !done && progress?.total ? `${progress.done}/${progress.total}` : '';
    const md = new vscode.MarkdownString(
      locked
        ? `**${chapter.titulo}**\n\n🔒 Se desbloquea al completar el capítulo anterior.`
        : `**${chapter.titulo}**\n\n${chapter.descripcion}\n\n` +
            `Clic: abrir el manual · ${chapter.ejercicios.length} ejercicio(s)${chapter.minutos ? ` · ${chapter.minutos} min` : ''}` +
            (chapter.evaluacion?.length
              ? `\n\nEvaluación: ${chapter.evaluacion.length} pregunta(s), aprobación ≥${chapter.aprobacion}%${chapter.evaluacionRequerida ? ' (obligatoria)' : ''}` +
                (quiz?.tried ? (quiz.passed ? ' — aprobada' : ' — por repetir') : '')
              : '')
    );
    md.supportThemeIcons = true;
    this.tooltip = md;
    this.iconPath = locked
      ? new vscode.ThemeIcon('lock', DIM)
      : done
        ? new vscode.ThemeIcon('pass-filled', GREEN)
        : expand
          ? new vscode.ThemeIcon('play-circle', BLUE)
          : new vscode.ThemeIcon('circle-large-outline');
    // solo los capítulos sin ejercicios ni evaluación (teoría) se marcan a mano; el resto se completa solo
    if (!locked && !chapter.ejercicios.length && !chapter.evaluacion?.length) {
      this.checkboxState = done ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    }
    if (!locked) {
      this.command = { command: 'tutor.openChapter', title: 'Abrir manual', arguments: [course, chapter] };
    }
    this.contextValue = locked ? 'tutorChapterLocked' : 'tutorChapter' + (chapter.evaluacion?.length ? 'Quiz' : '');
  }
}

export class ExerciseItem extends vscode.TreeItem {
  constructor(
    public readonly course: Course,
    public readonly chapter: Chapter,
    public readonly exercise: Exercise,
    done: boolean,
    tests?: { passed: number; total: number }
  ) {
    super(exercise.titulo, vscode.TreeItemCollapsibleState.None);
    this.id = `exercise:${course.id}:${chapter.id}:${exercise.id}`;
    const failing = !done && !!tests && tests.passed < tests.total;
    const status = done ? 'resuelto' : tests ? `pruebas ${tests.passed}/${tests.total}` : 'pendiente';
    this.description = done ? '' : tests ? `${tests.passed}/${tests.total}` : '';
    const md = new vscode.MarkdownString(
      `**${exercise.titulo}**\n\nClic: abre tu archivo y el enunciado.\n\n` +
        `Estado: ${status}${exercise.lenguaje ? ` · ${exercise.lenguaje}` : ''}\n\n` +
        (done ? 'Resuelto: la solución está disponible (💡).' : 'Se resuelve al pasar todas las pruebas.')
    );
    md.supportThemeIcons = true;
    this.tooltip = md;
    this.iconPath = done
      ? new vscode.ThemeIcon('pass-filled', GREEN)
      : failing
        ? new vscode.ThemeIcon('error', RED)
        : tests
          ? new vscode.ThemeIcon('circle-large-filled', YELLOW)
          : new vscode.ThemeIcon('circle-large-outline');
    this.command = { command: 'tutor.openExercise', title: 'Abrir ejercicio', arguments: [course, chapter, exercise] };
    this.contextValue =
      'tutorExercise' + (done ? 'Done' : '') + (exercise.lenguaje || exercise.pruebasComando ? 'Runnable' : '') +
      (exercise.pruebas || exercise.pruebasComando ? 'Tests' : '');
  }
}

export class NextStepItem extends vscode.TreeItem {
  constructor(public readonly step: NextStep) {
    super(ui(step.label), vscode.TreeItemCollapsibleState.None);
    this.id = `next:${step.course.id}`;
    this.description = `${step.done}/${step.total}`;
    this.tooltip = `Siguiente paso (${step.done}/${step.total} del capítulo): te lleva a lo que toca ahora.`;
    this.iconPath = new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.blue'));
    this.command = { command: 'tutor.nextStep', title: 'Siguiente paso', arguments: [step.course.id] };
    this.contextValue = 'tutorNext';
  }
}
