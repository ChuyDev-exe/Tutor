import * as vscode from 'vscode';
import { focusMode } from './a11y';
import { Chapter, Course, Exercise, TutorContext } from './types';
import { runtimeFor, hasTests } from './runner';

export interface ResolvedContext {
  course?: Course;
  chapter?: Chapter;
  exercise?: Exercise;
}

/**
 * Botones en la barra de estado:
 *  - Evaluación: indica si la parte del curso actual tiene preguntas.
 *  - Ejecutar código: corre la solución del ejercicio activo.
 *  - Ejecutar pruebas: corre las pruebas del ejercicio activo y muestra el resultado.
 */
export class StatusBarManager {
  private quizItem: vscode.StatusBarItem;
  private runItem: vscode.StatusBarItem;
  private testsItem: vscode.StatusBarItem;
  private progressItem: vscode.StatusBarItem;
  private statementItem: vscode.StatusBarItem;
  private hintItem: vscode.StatusBarItem;

  constructor(
    private getCtx: () => TutorContext,
    private getCourses: () => Course[],
    private getProgress: () => string | undefined = () => undefined,
    private isDone: (course: Course, chapter: Chapter, exercise: Exercise) => boolean = () => false,
    private hintsShown: (course: Course, chapter: Chapter, exercise: Exercise) => number = () => 0
  ) {
    this.statementItem = vscode.window.createStatusBarItem('tutor.status.statement', vscode.StatusBarAlignment.Left, 99.9);
    this.statementItem.command = 'tutor.viewStatement';
    this.hintItem = vscode.window.createStatusBarItem('tutor.status.hint', vscode.StatusBarAlignment.Left, 97);
    this.progressItem = vscode.window.createStatusBarItem('tutor.status.progress', vscode.StatusBarAlignment.Left, 101);
    this.progressItem.command = 'tutor.dashboard';
    this.quizItem = vscode.window.createStatusBarItem('tutor.status.quiz', vscode.StatusBarAlignment.Left, 100);
    this.runItem = vscode.window.createStatusBarItem('tutor.status.run', vscode.StatusBarAlignment.Left, 99);
    this.testsItem = vscode.window.createStatusBarItem('tutor.status.tests', vscode.StatusBarAlignment.Left, 98);
    this.quizItem.command = 'tutor.statusQuiz';
    this.runItem.command = 'tutor.statusRun';
    this.testsItem.command = 'tutor.statusTests';
    this.update();
  }

  private timer?: NodeJS.Timeout;
  private later(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.progressItem.dispose();
    this.statementItem.dispose();
    this.hintItem.dispose();
    this.timer = setTimeout(() => this.update(), ms);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.quizItem.dispose();
    this.runItem.dispose();
    this.testsItem.dispose();
  }

  resolve(): ResolvedContext {
    const ctx = this.getCtx();
    const course = this.getCourses().find((c) => c.id === ctx.courseId);
    const chapter = course?.capitulos.find((c) => c.id === ctx.chapterId);
    const exercise = chapter?.ejercicios.find((e) => e.id === ctx.exerciseId);
    return { course, chapter, exercise };
  }

  update(): void {
    const { course, chapter, exercise } = this.resolve();
    const prog = this.getProgress();
    if (prog) {
      this.progressItem.text = `$(mortar-board) ${prog}`;
      this.progressItem.tooltip = 'Tutor: ver mi progreso';
      this.progressItem.show();
    } else {
      this.progressItem.hide();
    }
    // los botones solo existen cuando hay algo que evaluar/ejecutar
    chapter && !focusMode() ? this.quizItem.show() : this.quizItem.hide();
    exercise && runtimeFor(exercise.lenguaje) ? this.runItem.show() : this.runItem.hide();
    exercise && hasTests(exercise) ? this.testsItem.show() : this.testsItem.hide();

    // Evaluación: ¿esta parte del curso tiene preguntas?
    const nQuiz = chapter?.evaluacion?.length ?? 0;
    if (!chapter) {
      this.quizItem.text = '$(checklist) Evaluación';
      this.quizItem.tooltip = 'Abre un capítulo para ver si tiene evaluación.';
      this.quizItem.color = undefined;
    } else if (nQuiz > 0) {
      this.quizItem.text = `$(checklist) Evaluación: ${nQuiz} preguntas`;
      this.quizItem.tooltip = `"${chapter.titulo}" tiene ${nQuiz} pregunta(s) de opción múltiple.\nClick para abrir.`;
      this.quizItem.color = undefined;
    } else {
      this.quizItem.text = '$(circle-slash) Sin evaluación';
      this.quizItem.tooltip = `"${chapter.titulo}" es teórico o no define "evaluacion" en curso.json.`;
      this.quizItem.color = new vscode.ThemeColor('descriptionForeground');
    }

    // Enunciado y pista/solución: solo con un ejercicio activo
    if (exercise && chapter && course) {
      this.statementItem.text = '$(book) Enunciado';
      this.statementItem.tooltip = `Ver el enunciado de «${exercise.titulo}»`;
      this.statementItem.show();
      if (this.isDone(course, chapter, exercise)) {
        this.hintItem.text = '$(lightbulb) Solución';
        this.hintItem.tooltip = 'Ver la solución (desbloqueada)';
        this.hintItem.command = 'tutor.viewSolution';
        this.hintItem.show();
      } else if (exercise.pistaFiles.length) {
        const shown = this.hintsShown(course, chapter, exercise);
        const total = exercise.pistaFiles.length;
        this.hintItem.text = shown >= total ? `$(question) Pistas ${total}/${total}` : `$(question) Pista ${shown + 1}/${total}`;
        this.hintItem.tooltip = shown >= total ? 'Ya viste todas las pistas (clic para releerlas)' : 'Pedir la siguiente pista (la solución se desbloquea al pasar las pruebas)';
        this.hintItem.command = 'tutor.viewHint';
        this.hintItem.show();
      } else {
        this.hintItem.hide();
      }
    } else {
      this.statementItem.hide();
      this.hintItem.hide();
    }

    // Ejecutar código
    if (!exercise) {
      this.runItem.text = '$(play) Correr';
      this.runItem.tooltip = 'Selecciona un ejercicio de programación en el árbol de capítulos.';
      this.runItem.color = new vscode.ThemeColor('descriptionForeground');
    } else if (!runtimeFor(exercise.lenguaje)) {
      this.runItem.text = '$(play) Sin runtime';
      this.runItem.tooltip = `El ejercicio "${exercise.titulo}" no tiene lenguaje con runtime embebido (python, javascript, typescript, bash, c, cpp, go).`;
      this.runItem.color = new vscode.ThemeColor('descriptionForeground');
    } else {
      this.runItem.text = '$(play) Correr';
      this.runItem.tooltip = `Ejecutar tu solución de "${exercise.titulo}" (${exercise.lenguaje}).\nTu archivo está en la carpeta del alumno.`;
      this.runItem.color = undefined;
    }

    // Ejecutar pruebas
    if (!exercise) {
      this.testsItem.text = '$(beaker) Pruebas';
      this.testsItem.tooltip = 'Selecciona un ejercicio con pruebas definidas.';
      this.testsItem.color = new vscode.ThemeColor('descriptionForeground');
    } else if (!hasTests(exercise)) {
      this.testsItem.text = '$(beaker) Sin pruebas';
      this.testsItem.tooltip = `El ejercicio "${exercise.titulo}" no define "pruebas" ni "pruebasComando" en curso.json.`;
      this.testsItem.color = new vscode.ThemeColor('descriptionForeground');
    } else {
      this.testsItem.text = '$(beaker) Pruebas';
      this.testsItem.tooltip = `Correr las pruebas de "${exercise.titulo}". Los resultados se abren en la tab "Tutor: Resultados".`;
      this.testsItem.color = undefined;
    }

    void course;
  }

  flashTests(passed: number, total: number): void {
    const ok = total > 0 && passed === total;
    this.testsItem.text = ok
      ? `$(beaker) Pruebas ${passed}/${total} ✓`
      : `$(beaker) Pruebas ${passed}/${total} ✗`;
    this.testsItem.color = ok
      ? new vscode.ThemeColor('testing.iconPassed')
      : new vscode.ThemeColor('testing.iconFailed');
    this.later(6000);
  }

  flashRun(ok: boolean): void {
    this.runItem.text = ok ? '$(play) Correr ✓' : '$(play) Correr ✗';
    this.runItem.color = ok
      ? new vscode.ThemeColor('testing.iconPassed')
      : new vscode.ThemeColor('testing.iconFailed');
    this.later(4000);
  }

  flashQuiz(has: boolean, n: number): void {
    this.quizItem.text = has ? `$(checklist) ${n} preguntas` : '$(circle-slash) Sin evaluación';
    this.later(4000);
  }
}
