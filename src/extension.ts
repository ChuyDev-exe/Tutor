import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChapterItem, ChaptersProvider, ExerciseItem, exKey } from './chaptersProvider';
import { SearchViewProvider } from './searchProvider';
import { ChatViewProvider } from './chatProvider';
import { QuizViewManager } from './quizView';
import { ResultsViewManager } from './resultsView';
import { StatusBarManager } from './statusBar';
import { Chapter, Course, Exercise, TutorContext } from './types';
import { PROVIDERS, ProviderDef, getApiKey, getProviderDef, setApiKey, getActiveConfig, listModels } from './aiClient';
import { tutorState } from './state';
import { renderMarkdown } from './md';
import { checkRequirements, formatReport, openManual, runSetup, validateOnOpen } from './requirements';
import { runSolution, runTestsFor, hasTests, runtimeFor, TestReport, RunResult } from './runner';
import { runInTerminal } from './terminalRun';
import {
  ensureChapterManual,
  ensureExerciseFile,
  ensureStatement,
  exerciseFile,
  manualFileFor,
  resetExerciseFile,
  statementFile,
  writeHints,
  studentRoot,
  syncStudentFolder,
} from './studentFolder';
import { broadcastA11y, focusMode, notify, pickProfiles } from './a11y';
import { FocusTimer } from './focus';
import { FocusLayout } from './focusLayout';
import { FocusViewProvider } from './focusView';
import { PreferencesPanel } from './preferences';
import { parkThought, thoughtsPath } from './thoughts';
import { buildDashboard } from './dashboard';
import { formatIssues, validateCourseDir } from './validator';
import { ensureDoubtsFile } from './doubts';

let tutorContext: TutorContext = {};

const summarizeRun = (r: RunResult): string =>
  [r.error, r.stderr || r.stdout].filter(Boolean).join('\n').trim() || '(sin salida)';

function summarizeTests(t: TestReport): string {
  if (t.kind === 'command') return `Comando de pruebas ${t.passed ? 'aprobado' : 'falló'}:\n${t.output ?? ''}`;
  const failed = (t.cases ?? []).filter((c) => !c.ok);
  if (!failed.length) return `Pruebas: ${t.passed}/${t.total} superadas.`;
  return (
    `Pruebas: ${t.passed}/${t.total}. Fallan:\n` +
    failed.map((c) => `- ${c.nombre}: esperado «${c.esperado}», obtuvo «${c.obtenido}» ${c.stderr}`).join('\n')
  );
}

export function activate(context: vscode.ExtensionContext): void {
  tutorState.init(context);
  const chapters = new ChaptersProvider(context);
  const quizView = new QuizViewManager(context, chapters);
  const resultsView = new ResultsViewManager();
  const focusTimer = new FocusTimer(new FocusLayout(context));
  const preferences = new PreferencesPanel(context);
  const out = vscode.window.createOutputChannel('Tutor');
  context.subscriptions.push(out);

  const logRun = (title: string, r: RunResult): void => {
    out.clear();
    out.appendLine(`== Correr: ${title} (${r.durationMs} ms) ==`);
    if (r.stdout) out.appendLine(r.stdout.trimEnd());
    if (r.stderr) out.appendLine(`-- errores --\n${r.stderr.trimEnd()}`);
    out.appendLine(r.ok ? 'OK: terminó sin errores.' : `ERROR: ${r.error || 'código de salida ' + r.exitCode}`);
    out.show(true);
  };

  const logTests = (title: string, t: TestReport): void => {
    out.clear();
    out.appendLine(`== Pruebas: ${title} — ${t.passed}/${t.total} (${t.durationMs} ms) ==`);
    if (t.kind === 'command') out.appendLine((t.output ?? '').trimEnd());
    for (const c of t.cases ?? []) {
      out.appendLine(`${c.ok ? 'OK    ' : 'FALLA '} ${c.nombre}`);
      if (!c.ok) {
        out.appendLine(`   esperado: ${c.esperado}`);
        out.appendLine(`   obtenido: ${c.obtenido}`);
        if (c.stderr) out.appendLine(`   errores:  ${c.stderr.trim()}`);
      }
    }
    if (t.output && t.kind !== 'command') out.appendLine(t.output);
    out.appendLine(t.total > 0 && t.passed === t.total ? 'TODAS LAS PRUEBAS PASAN.' : 'Revisa los casos que fallan y vuelve a intentar.');
    out.show(true);
  };
  const statusBar = new StatusBarManager(
    () => tutorContext,
    () => chapters.allCourses,
    () => {
      const p = chapters.overallPercent();
      return p === undefined || focusMode() ? undefined : `Tutor ${p}%`;
    },
    (course, chapter, exercise) => chapters.isDone(course.id, exKey(chapter.id, exercise.id)),
    (course, chapter, exercise) => chapters.hintsShown(course.id, chapter.id, exercise.id)
  );

  const setContext = (ctx: TutorContext): void => {
    const same = ctx.exerciseId && ctx.exerciseId === tutorContext.exerciseId;
    tutorContext = { ...ctx, lastOutput: same ? tutorContext.lastOutput : undefined, studentFile: same ? tutorContext.studentFile : undefined };
    statusBar.update();
  };

  // ── Utilidades ──────────────────────────────────────────────────────
  const courseId = (arg: unknown): string | undefined =>
    typeof arg === 'string' ? arg : (arg as { course?: Course } | undefined)?.course?.id;

  const pickCourse = async (arg?: unknown): Promise<Course | undefined> => {
    const all = chapters.allCourses;
    const id = courseId(arg);
    const byId = id && all.find((c) => c.id === id);
    if (byId) return byId;
    const cur = all.find((c) => c.id === tutorContext.courseId);
    if (cur) return cur;
    if (all.length === 1) return all[0];
    if (!all.length) {
      notify('Tutor: aún no hay cursos instalados.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      all.map((c) => ({ label: c.titulo, description: c.id, course: c })),
      { title: 'Selecciona un curso' }
    );
    return pick?.course;
  };

  /** Ejercicio objetivo: el del nodo pulsado en el árbol o el activo de la barra de estado. */
  const target = (arg: unknown): { course?: Course; chapter?: Chapter; exercise?: Exercise } => {
    const a = arg as Partial<ExerciseItem> | undefined;
    if (a?.exercise && a.course && a.chapter) return { course: a.course, chapter: a.chapter, exercise: a.exercise };
    return statusBar.resolve();
  };

  const isUnlocked = (course: Course, chapter: Chapter): boolean =>
    chapters.isChapterUnlocked(course.id, course.capitulos.findIndex((c) => c.id === chapter.id));

  const guard = (course: Course, chapter: Chapter): boolean => {
    if (isUnlocked(course, chapter)) return true;
    notify(`«${chapter.titulo}» se desbloquea al completar el capítulo anterior.`);
    return false;
  };

  const syncFolder = (course: Course): string | undefined => {
    try {
      return syncStudentFolder(course, (i) => chapters.isChapterUnlocked(course.id, i));
    } catch (err) {
      vscode.window.showErrorMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  };

  // ── Vistas ──────────────────────────────────────────────────────────
  const chaptersTree = vscode.window.createTreeView('tutorChapters', { treeDataProvider: chapters });
  const updateMeta = (): void => {
    const pct = chapters.overallPercent();
    const calm = focusMode();
    chaptersTree.message =
      pct === undefined || calm
        ? undefined
        : `Progreso: ${pct}%` + (!hideStreakSetting() && tutorState.streak() > 1 ? ` · racha de ${tutorState.streak()} días` : '');
    chaptersTree.badge = pct === undefined || calm ? undefined : { value: pct, tooltip: `${pct}% completado` };
    statusBar.update();
  };
  const hideStreakSetting = (): boolean =>
    vscode.workspace.getConfiguration('tutor').get<boolean>('accesibilidad.ocultarRacha', false);
  context.subscriptions.push(chaptersTree, focusTimer, chapters.onDidChangeTreeData(() => updateMeta()));

  const focusView = new FocusViewProvider(focusTimer, () => {
    for (const c of chapters.allCourses) {
      const s = chapters.nextStep(c);
      if (s) return { label: s.label, done: s.done, total: s.total };
    }
    return undefined;
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FocusViewProvider.viewType, focusView),
    chapters.onDidChangeTreeData(() => focusView.refresh()),
    // la actividad del alumno alimenta el aviso suave de inactividad
    vscode.workspace.onDidChangeTextDocument(() => focusTimer.noteActivity()),
    vscode.window.onDidChangeTextEditorSelection(() => focusTimer.noteActivity()),
    vscode.window.onDidChangeActiveTextEditor(() => focusTimer.noteActivity())
  );

  const searchView = new SearchViewProvider(context, () => ({
    reload: () => chapters.reload(),
    allCourses: chapters.allCourses,
    isUnlocked: (id: string, index: number) => chapters.isChapterUnlocked(id, index),
  }));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(SearchViewProvider.viewType, searchView));

  const chatView = new ChatViewProvider(context, () => chapters.allCourses, () => tutorContext);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Al cambiar de pestaña a un archivo/enunciado de ejercicio, la barra de estado sigue a ese ejercicio
  const followEditor = (ed?: vscode.TextEditor): void => {
    if (!ed) return;
    const fsPath = ed.document.uri.fsPath;
    for (const course of chapters.allCourses) {
      for (const chapter of course.capitulos) {
        try {
          if (fsPath === manualFileFor(course, chapter)) {
            setContext({ courseId: course.id, chapterId: chapter.id });
            return;
          }
          for (const ex of chapter.ejercicios) {
            const file = exerciseFile(course, chapter, ex);
            if (fsPath === file || fsPath === statementFile(course, chapter, ex)) {
              if (tutorContext.exerciseId !== ex.id) {
                setContext({ courseId: course.id, chapterId: chapter.id, exerciseId: ex.id });
                tutorContext = { ...tutorContext, studentFile: file };
              }
              return;
            }
          }
        } catch {
          return; // sin workspace
        }
      }
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(followEditor));

  // ── Progreso: checkboxes y efectos ──────────────────────────────────
  context.subscriptions.push(
    chaptersTree.onDidChangeCheckboxState(async (e) => {
      for (const [item, state] of e.items) {
        await chapters.toggleFromTree(item, state === vscode.TreeItemCheckboxState.Checked);
      }
    }),
    chapters.onDidChangeQuiz(() => statusBar.update()),
    statusBar
  );

  chapters.onDidChangeProgress(async (e) => {
    const course = chapters.allCourses.find((c) => c.id === e.courseId);
    const chapter = course?.capitulos.find((c) => c.id === e.chapterId);
    if (!course || !chapter) return;
    // ejercicio resuelto o evaluación aprobada → ¿se completó el capítulo?
    if (e.done && (e.kind === 'exercise' || e.kind === 'quiz')) {
      await chapters.tryAutoComplete(course, chapter);
    }
    if (e.kind === 'chapter' && e.done && syncFolder(course)) {
      const next = course.capitulos[course.capitulos.findIndex((c) => c.id === e.chapterId) + 1];
      notify(
        next
          ? `Capítulo completado. Se desbloqueó «${next.titulo}» (manual y ejercicios en tu carpeta).`
          : `Completaste «${course.titulo}».`
      );
    }
  });

  // ── Ejecutar código y pruebas ───────────────────────────────────────
  /** Abre el archivo del alumno en el editor (reutiliza la pestaña/columna si ya está visible). */
  const openStudentFile = async (course: Course, chapter: Chapter, exercise: Exercise, focus = true) => {
    const file = ensureExerciseFile(course, chapter, exercise);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    if (doc.isDirty) await doc.save();
    const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === file);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: !focus,
      viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
    });
    return file;
  };

  const showStatement = async (course: Course, chapter: Chapter, exercise: Exercise): Promise<void> => {
    const md = ensureStatement(course, chapter, exercise);
    await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(md));
  };

  /** Ejercicio sin pruebas: se resuelve al correr sin errores; sin runtime ni pruebas (lectura): al abrirlo. */
  const settleUntested = async (course: Course, chapter: Chapter, exercise: Exercise, ranOk: boolean): Promise<void> => {
    if (hasTests(exercise) || chapters.isDone(course.id, exKey(chapter.id, exercise.id))) return;
    const hasRuntime = !!runtimeFor(exercise.lenguaje);
    if ((hasRuntime && ranOk) || !hasRuntime) {
      await chapters.setExerciseDone(course.id, chapter.id, exercise.id, true);
      notify(`«${exercise.titulo}» resuelto.`);
    }
  };

  const runExercise = async (course?: Course, chapter?: Chapter, exercise?: Exercise): Promise<void> => {
    if (!course || !chapter || !exercise) {
      notify('Tutor: selecciona un ejercicio de programación para ejecutar código.');
      return;
    }
    const blocking = (await validateOnOpen(course, true)).filter((s) => s.obligatorio && (!s.found || !s.versionOk));
    if (blocking.length) return;
    try {
      const file = await openStudentFile(course, chapter, exercise);
      const inTerminal = vscode.workspace.getConfiguration('tutor').get<boolean>('correrEnTerminal', true);
      const result = inTerminal ? await runInTerminal(file, exercise.lenguaje, exercise.titulo) : await runSolution(file, exercise.lenguaje);
      chapters.recordExercise(course.id, chapter.id, exercise.id, { run: true });
      tutorContext = { ...tutorContext, courseId: course.id, chapterId: chapter.id, exerciseId: exercise.id, studentFile: file, lastOutput: summarizeRun(result) };
      statusBar.flashRun(result.ok);
      if (!inTerminal) logRun(exercise.titulo, result);
      if (result.ok) await settleUntested(course, chapter, exercise, true);
    } catch (err) {
      vscode.window.showErrorMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
    }
  };

  const testExercise = async (course?: Course, chapter?: Chapter, exercise?: Exercise): Promise<void> => {
    if (!course || !chapter || !exercise) {
      notify('Tutor: selecciona un ejercicio con pruebas para ejecutarlas.');
      return;
    }
    if (!hasTests(exercise)) {
      notify(`El ejercicio «${exercise.titulo}» no tiene pruebas definidas.`);
      return;
    }
    const blocking = (await validateOnOpen(course, true)).filter((s) => s.obligatorio && (!s.found || !s.versionOk));
    if (blocking.length) return;
    try {
      const file = await openStudentFile(course, chapter, exercise);
      const report = await runTestsFor(context, course, chapter, exercise);
      chapters.recordExercise(course.id, chapter.id, exercise.id, { passed: report.passed, total: report.total });
      tutorContext = { ...tutorContext, courseId: course.id, chapterId: chapter.id, exerciseId: exercise.id, studentFile: file, lastOutput: summarizeTests(report) };
      statusBar.flashTests(report.passed, report.total);
      logTests(exercise.titulo, report);
      const allOk = report.total > 0 && report.passed === report.total;
      const auto = vscode.workspace.getConfiguration('tutor').get<boolean>('autoCompleteOnPass', true);
      if (allOk && auto && !chapters.isDone(course.id, `${chapter.id}/${exercise.id}`)) {
        await chapters.setExerciseDone(course.id, chapter.id, exercise.id, true);
        const day = tutorState.focusToday();
        const goal = vscode.workspace.getConfiguration('tutor').get<number>('focus.metaDiaria', 3);
        notify(
          `«${exercise.titulo}» resuelto. Se desbloqueó la solución.` +
            (focusMode() ? ` Hoy: ${day.ejercicios}/${goal}${day.ejercicios >= goal ? ' — meta cumplida.' : '.'}` : '')
        );
      } else if (!allOk && focusMode() && report.total > 0) {
        vscode.window.setStatusBarMessage(
          `Casi: ${report.passed}/${report.total} pruebas. Revisa el primer caso que falla; no hace falta arreglarlo todo a la vez.`,
          9000
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
    }
  };

  // ── Comandos ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('tutor.openChapter', async (course: Course, chapter: Chapter) => {
      if (!guard(course, chapter)) return;
      setContext({ courseId: course.id, chapterId: chapter.id });
      focusTimer.autoStart();
      let file = chapter.archivo;
      try {
        syncFolder(course);
        file = ensureChapterManual(course, chapter);
      } catch {
        /* sin workspace: se abre el original */
      }
      await openChapterPreview(file);
      chapters.markManualRead(course.id, chapter.id);
    }),

    // Entrar a un ejercicio: abre TU archivo (.c, .py…) en el editor y el enunciado (.md) a su lado
    vscode.commands.registerCommand('tutor.openExercise', async (course: Course, chapter: Chapter, exercise: Exercise) => {
      if (!guard(course, chapter)) return;
      setContext({ courseId: course.id, chapterId: chapter.id, exerciseId: exercise.id });
      focusTimer.autoStart();
      void validateOnOpen(course);
      try {
        const file = await openStudentFile(course, chapter, exercise, false);
        tutorContext = { ...tutorContext, studentFile: file };
        await showStatement(course, chapter, exercise);
        await openStudentFile(course, chapter, exercise, true); // el cursor vuelve al código
        await settleUntested(course, chapter, exercise, false);
      } catch (err) {
        vscode.window.showWarningMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand('tutor.openQuiz', (course: Course, chapter: Chapter) => {
      if (!guard(course, chapter)) return;
      setContext({ courseId: course.id, chapterId: chapter.id });
      quizView.open(course, chapter);
    }),

    // Un solo botón que lleva a lo que toca ahora (menos decisiones, menos distracción)
    vscode.commands.registerCommand('tutor.nextStep', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      if (!course) return;
      const step = chapters.nextStep(course);
      if (!step) {
        notify(`Completaste «${course.titulo}».`);
        return;
      }
      if (step.kind === 'manual') await vscode.commands.executeCommand('tutor.openChapter', course, step.chapter);
      else if (step.kind === 'exercise') await vscode.commands.executeCommand('tutor.openExercise', course, step.chapter, step.exercise);
      else if (step.kind === 'quiz') await vscode.commands.executeCommand('tutor.openQuiz', course, step.chapter);
      else await chapters.setChapterDone(course.id, step.chapter.id, true);
    }),

    vscode.commands.registerCommand('tutor.refresh', () => {
      chapters.reload();
      void chatView.refreshConfig();
      updateMeta();
      notify('Tutor: contenido recargado.');
    }),

    vscode.commands.registerCommand('tutor.searchRepo', () => {
      void vscode.commands.executeCommand('tutorSearch.focus');
    }),

    vscode.commands.registerCommand('tutor.dashboard', () => {
      resultsView.showHtml('Mi progreso', buildDashboard(chapters));
    }),

    // Archivo de dudas del alumno (se rellena solo con las preguntas al tutor)
    vscode.commands.registerCommand('tutor.openDoubts', async () => {
      const cur = chapters.allCourses.find((c) => c.id === tutorContext.courseId);
      const course = cur ?? (chapters.allCourses.length === 1 ? chapters.allCourses[0] : undefined);
      try {
        const file = ensureDoubtsFile(course);
        if (!file) {
          notify('Tutor: abre una carpeta de workspace para guardar tus dudas.');
          return;
        }
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
      }
    }),

    // Para autores: revisa la estructura de un curso antes de publicarlo
    vscode.commands.registerCommand('tutor.validateCourseFiles', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Validar curso',
        title: 'Carpeta del curso (con curso.json)',
        defaultUri: tutorState.coursesDir() ? vscode.Uri.file(tutorState.coursesDir()!) : undefined,
      });
      if (!picked?.length) return;
      const issues = validateCourseDir(picked[0].fsPath);
      out.clear();
      out.appendLine(`== Validación: ${picked[0].fsPath} ==`);
      out.appendLine(formatIssues(issues));
      out.show(true);
      const errors = issues.filter((i) => i.nivel === 'error').length;
      notify(errors ? `Tutor: el curso tiene ${errors} error(es). Revisa Salida → Tutor.` : 'Tutor: el curso es válido.');
    }),

    // «Estacionar» un pensamiento que distrae, sin salir de lo que haces
    vscode.commands.registerCommand('tutor.parkThought', async () => {
      const text = await vscode.window.showInputBox({
        title: 'Anota lo que te distrajo',
        prompt: 'Escríbelo en una línea y sigue con lo que estabas haciendo. Lo verás luego en pensamientos-pendientes.md',
        placeHolder: 'p. ej. responder a María, mirar el precio del curso…',
        validateInput: (v) => (v.trim() ? undefined : 'Escribe algo breve'),
      });
      if (!text) return;
      const cur = chapters.allCourses.find((c) => c.id === tutorContext.courseId);
      const course = cur ?? (chapters.allCourses.length === 1 ? chapters.allCourses[0] : undefined);
      try {
        if (parkThought(course, text)) notify('Anotado. Ya puedes soltarlo y seguir con lo tuyo.');
        else notify('Tutor: abre una carpeta de workspace para guardar tus pensamientos.');
      } catch (err) {
        vscode.window.showErrorMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand('tutor.openThoughts', async () => {
      const cur = chapters.allCourses.find((c) => c.id === tutorContext.courseId);
      const file = thoughtsPath(cur ?? (chapters.allCourses.length === 1 ? chapters.allCourses[0] : undefined));
      if (!file || !fs.existsSync(file)) {
        notify('Aún no has anotado ningún pensamiento.');
        return;
      }
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
    }),

    vscode.commands.registerCommand('tutor.preferences', () => preferences.open()),
    vscode.commands.registerCommand('tutor.accessibility', () => preferences.open()),
    vscode.commands.registerCommand('tutor.accessibilityQuick', () => pickProfiles()),

    // ── Temporizador de enfoque ───────────────────────────────────────
    vscode.commands.registerCommand('tutor.focusToggle', () => focusTimer.toggle()),
    vscode.commands.registerCommand('tutor.focusStart', async () => {
      const presets = [
        { label: '15 min trabajo / 3 min descanso', w: 15, b: 3 },
        { label: '25 min trabajo / 5 min descanso (clásico)', w: 25, b: 5 },
        { label: '45 min trabajo / 10 min descanso', w: 45, b: 10 },
      ];
      const pick = await vscode.window.showQuickPick(presets, { title: 'Temporizador de enfoque' });
      if (!pick) return;
      const c = vscode.workspace.getConfiguration('tutor');
      await c.update('focus.minutosTrabajo', pick.w, vscode.ConfigurationTarget.Global);
      await c.update('focus.minutosDescanso', pick.b, vscode.ConfigurationTarget.Global);
      focusTimer.start('trabajo');
    }),
    vscode.commands.registerCommand('tutor.focusStop', () => focusTimer.stop()),

    vscode.commands.registerCommand('tutor.resetProgress', async () => {
      const pick = await vscode.window.showWarningMessage(
        '¿Reiniciar todo el progreso (capítulos, ejercicios y evaluaciones) de este workspace?',
        { modal: true },
        'Sí, reiniciar'
      );
      if (pick === 'Sí, reiniciar') {
        await chapters.reset();
        notify('Tutor: progreso reiniciado.');
      }
    }),

    // ── Importar / desinstalar ────────────────────────────────────────
    vscode.commands.registerCommand('tutor.importCourseFolder', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) {
        vscode.window.showErrorMessage('Tutor: abre una carpeta de workspace para importar el curso.');
        return;
      }
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Importar curso',
        title: 'Selecciona una carpeta con curso.json (estructura de curso de Tutor IDE)',
      });
      if (!picked?.length) return;
      const src = picked[0].fsPath;
      const manifestPath = path.join(src, 'curso.json');
      if (!fs.existsSync(manifestPath)) {
        vscode.window.showErrorMessage('Tutor: la carpeta seleccionada no contiene curso.json. Revisa el formato en el README.');
        return;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const id = path.basename(String(manifest.id || path.basename(src)));
        const dest = path.join(tutorState.coursesDir()!, id);
        if (fs.existsSync(dest)) {
          const ow = await vscode.window.showWarningMessage(
            `El curso «${id}» ya está instalado. ¿Sobrescribir? (tu progreso y tus archivos se conservan)`,
            { modal: true },
            'Sobrescribir'
          );
          if (ow !== 'Sobrescribir') return;
          fs.rmSync(dest, { recursive: true, force: true });
        }
        fs.cpSync(src, dest, { recursive: true });
        tutorState.registerCourse(id, src);
        chapters.reload();
        void vscode.commands.executeCommand('tutor.courseInstalled', id);
      } catch (err) {
        vscode.window.showErrorMessage(`Tutor: error importando el curso (${err instanceof Error ? err.message : err})`);
      }
    }),

    vscode.commands.registerCommand('tutor.uninstallCourse', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      const base = tutorState.coursesDir();
      if (!course || !base || !path.resolve(course.root).startsWith(path.resolve(base) + path.sep)) {
        notify('Tutor: solo se pueden desinstalar cursos instalados por la extensión.');
        return;
      }
      const pick = await vscode.window.showWarningMessage(
        `¿Desinstalar «${course.titulo}»? Se borran el curso (soluciones y pruebas) y tu progreso. Tu carpeta de trabajo no se toca.`,
        { modal: true },
        'Desinstalar'
      );
      if (pick !== 'Desinstalar') return;
      fs.rmSync(course.root, { recursive: true, force: true });
      delete tutorState.get().cursos[course.id];
      tutorState.resetProgress(course.id);
      chapters.reload();
      notify(`Tutor: «${course.titulo}» desinstalado.`);
    }),

    vscode.commands.registerCommand('tutor.revealStudentFolder', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      if (!course) return;
      try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(studentRoot(course)));
      } catch (err) {
        vscode.window.showErrorMessage(`Tutor: ${err instanceof Error ? err.message : err}`);
      }
    }),

    // ── Requisitos, setup y manual del curso ───────────────────────────
    vscode.commands.registerCommand('tutor.validateCourse', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      if (course) await validateOnOpen(course, true);
    }),

    // Tras descargar/importar: crea la carpeta del alumno, abre el primer paso y valida requisitos
    vscode.commands.registerCommand('tutor.courseInstalled', async (id: string, isUpdate?: boolean) => {
      const course = chapters.allCourses.find((c) => c.id === id);
      if (!course) return;
      const root = syncFolder(course);
      if (root) {
        const rel = path.relative(vscode.workspace.workspaceFolders![0].uri.fsPath, root);
        await vscode.commands.executeCommand('workbench.view.extension.tutor-container');
        notify(
          isUpdate
            ? `Tutor: «${course.titulo}» actualizado${course.version ? ` a la versión ${course.version}` : ''}. Tu progreso y tus archivos se conservan.`
            : `Tutor: «${course.titulo}» instalado. Tu carpeta de trabajo: «${rel}». Sigue el «Siguiente paso» del panel Tutor.`
        );
      }
      await validateOnOpen(course, true);
    }),

    vscode.commands.registerCommand('tutor.checkRequirements', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      if (!course) return;
      if (!course.requisitos.length) {
        notify(`«${course.titulo}» no declara requisitos.`);
        return;
      }
      const list = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Verificando requisitos…' },
        () => checkRequirements(course)
      );
      resultsView.showHtml(`Requisitos: ${course.titulo}`, renderMarkdown(formatReport(course, list)));
    }),

    vscode.commands.registerCommand('tutor.runSetup', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      if (course) await runSetup(course);
    }),

    vscode.commands.registerCommand('tutor.openManual', async (arg?: unknown) => {
      const course = await pickCourse(arg);
      if (course) await openManual(course);
    }),

    // ── Ejercicios (botones del árbol y de la barra de estado) ─────────
    vscode.commands.registerCommand('tutor.runExercise', (arg?: unknown) => {
      const t = target(arg);
      return runExercise(t.course, t.chapter, t.exercise);
    }),
    vscode.commands.registerCommand('tutor.testExercise', (arg?: unknown) => {
      const t = target(arg);
      return testExercise(t.course, t.chapter, t.exercise);
    }),
    vscode.commands.registerCommand('tutor.statusRun', () => {
      const t = statusBar.resolve();
      return runExercise(t.course, t.chapter, t.exercise);
    }),
    vscode.commands.registerCommand('tutor.statusTests', () => {
      const t = statusBar.resolve();
      return testExercise(t.course, t.chapter, t.exercise);
    }),

    vscode.commands.registerCommand('tutor.openExerciseFile', async (arg?: unknown) => {
      const { course, chapter, exercise } = target(arg);
      if (course && chapter && exercise) await openStudentFile(course, chapter, exercise, true);
    }),

    vscode.commands.registerCommand('tutor.resetExercise', async (arg?: unknown) => {
      const { course, chapter, exercise } = target(arg);
      if (!course || !chapter || !exercise) return;
      const pick = await vscode.window.showWarningMessage(
        `¿Restaurar tu archivo de «${exercise.titulo}» a la plantilla inicial? Se guarda una copia .bak.`,
        { modal: true },
        'Restaurar'
      );
      if (pick !== 'Restaurar') return;
      const file = resetExerciseFile(course, chapter, exercise);
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      notify('Tutor: archivo restaurado (copia en .bak).');
    }),

    vscode.commands.registerCommand('tutor.viewStatement', async (arg?: unknown) => {
      const { course, chapter, exercise } = target(arg);
      if (course && chapter && exercise) await showStatement(course, chapter, exercise);
    }),

    // Cada pulsación revela UNA pista más; todas quedan en <ejercicio>-pistas.md
    vscode.commands.registerCommand('tutor.viewHint', async (arg?: unknown) => {
      const { course, chapter, exercise } = target(arg);
      if (!course || !chapter || !exercise) return;
      const total = exercise.pistaFiles.length;
      if (!total) {
        notify('Este ejercicio no tiene pistas.');
        return;
      }
      const before = chapters.hintsShown(course.id, chapter.id, exercise.id);
      const shown = before >= total ? total : chapters.revealHint(course.id, chapter.id, exercise.id, total);
      const file = writeHints(course, chapter, exercise, shown);
      statusBar.update();
      chapters.refreshTree();
      await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(file));
      notify(shown >= total ? 'Esa fue la última pista.' : `Pista ${shown} de ${total}. Inténtalo antes de pedir la siguiente.`);
    }),

    vscode.commands.registerCommand('tutor.viewSolution', async (arg?: unknown) => {
      const { course, chapter, exercise } = target(arg);
      if (!course || !chapter || !exercise) return;
      if (!chapters.isDone(course.id, exKey(chapter.id, exercise.id))) {
        notify('La solución se desbloquea cuando el ejercicio pasa todas sus pruebas.');
        return;
      }
      if (!exercise.solucionFile || !fs.existsSync(exercise.solucionFile)) {
        notify('Este ejercicio no tiene solución publicada.');
        return;
      }
      await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(exercise.solucionFile));
    }),

    vscode.commands.registerCommand('tutor.openChapterQuiz', (item?: ChapterItem) => {
      if (item?.course && item.chapter) void vscode.commands.executeCommand('tutor.openQuiz', item.course, item.chapter);
    }),

    vscode.commands.registerCommand('tutor.statusQuiz', () => {
      const { course, chapter } = statusBar.resolve();
      if (!course || !chapter) {
        notify('Tutor: abre un capítulo del árbol para ver si tiene evaluación.');
        return;
      }
      if (!chapter.evaluacion?.length) {
        notify(`«${chapter.titulo}» no tiene evaluación.`);
        statusBar.flashQuiz(false, 0);
        return;
      }
      statusBar.flashQuiz(true, chapter.evaluacion.length);
      void vscode.commands.executeCommand('tutor.openQuiz', course, chapter);
    }),

    // ── IA ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('tutor.setApiKey', async () => {
      const providerId = await pickProvider();
      if (!providerId) return;
      const key = await askApiKey(context, getProviderDef(providerId));
      if (key === undefined) return;
      await setApiKey(context, providerId, key.trim());
      await chatView.refreshConfig();
      vscode.window.showInformationMessage('Tutor: API key guardada.');
    }),

    vscode.commands.registerCommand('tutor.configureAI', async () => {
      const providerId = await pickProvider();
      if (!providerId) return;
      const def = getProviderDef(providerId);

      // 1. API key (primero: hace falta para consultar la lista de modelos)
      if (def.needsKey) {
        const key = await askApiKey(context, def);
        if (key === undefined) return;
        if (key.trim()) await setApiKey(context, providerId, key.trim());
      }

      // 2. URL base: solo se pregunta cuando no es fija (local o compatible)
      let baseUrl = def.baseUrl;
      if (!def.needsKey || def.id === 'custom') {
        const typed = await vscode.window.showInputBox({
          title: `URL base de la API — ${def.label}`,
          value: def.baseUrl,
          placeHolder: 'https://…/v1',
          ignoreFocusOut: true,
          validateInput: (v) =>
            def.id === 'custom' && !v.trim() ? 'Introduce la URL base (compatible con OpenAI).' : undefined,
        });
        if (typed === undefined) return;
        baseUrl = typed;
      }

      // 3. Modelo: lista real del proveedor; si falla, la lista incluida
      let models = def.models;
      let live = false;
      for (;;) {
        try {
          models = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Consultando modelos de ${def.label}…` },
            async () => listModels(def, baseUrl, def.needsKey ? await getApiKey(context, providerId) : '')
          );
          live = true;
          break;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const rejected = /HTTP (401|403)/.test(reason);
          const stored = def.needsKey ? !!(await getApiKey(context, providerId)) : true;
          const pick = await vscode.window.showWarningMessage(
            rejected
              ? `${def.label} rechazó la API key (${reason}). Revisa que sea de ${def.label}, que esté completa y sin espacios.`
              : !stored
                ? `No hay API key guardada para ${def.label}.`
                : `No pude obtener la lista de modelos (${reason}).`,
            { modal: true },
            ...(def.needsKey ? ['Pegar otra clave'] : []),
            'Usar la lista habitual'
          );
          if (!pick) return;
          if (pick !== 'Pegar otra clave') break;
          const key = await askApiKey(context, def);
          if (key === undefined) return;
          await setApiKey(context, providerId, key.trim());
        }
      }
      const current = vscode.workspace.getConfiguration('tutor').get<string>('model');
      const picks: vscode.QuickPickItem[] = models.map((m) => ({
        label: m,
        description: m === current ? 'actual' : undefined,
      }));
      picks.push({ label: 'Otro modelo…', description: 'escribir el nombre a mano' });
      const pick = await vscode.window.showQuickPick(picks, {
        title: `Modelo — ${def.label}${live ? ` (${models.length} disponibles)` : ''}`,
        placeHolder: 'Elige un modelo (puedes escribir para filtrar)',
        matchOnDescription: true,
      });
      if (!pick) return;
      let model = pick.label;
      if (model === 'Otro modelo…') {
        model =
          (await vscode.window.showInputBox({ title: 'Nombre del modelo', ignoreFocusOut: true })) || '';
        if (!model) return;
      }

      const cfg = vscode.workspace.getConfiguration('tutor');
      await cfg.update('provider', providerId, vscode.ConfigurationTarget.Global);
      await cfg.update('apiBaseUrl', baseUrl.replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
      await cfg.update('model', model, vscode.ConfigurationTarget.Global);

      await chatView.refreshConfig();
      const active = await getActiveConfig(context);
      vscode.window.showInformationMessage(
        `Tutor: IA configurada → ${def.label} · ${active.model}`
      );
    })
  );


  // Cambios de configuración → refrescar chat, accesibilidad, árbol y barra de estado
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tutor')) {
        void chatView.refreshConfig();
        broadcastA11y();
        void preferences.push();
        focusView.refresh();
        chapters.refreshTree();
        updateMeta();
      }
    })
  );

  // Si `.tutor` cambia en disco (git pull, edición manual) se recarga
  const watcher = vscode.workspace.createFileSystemWatcher('**/.tutor');
  const reloadState = (): void => {
    chapters.reload();
    updateMeta();
  };
  context.subscriptions.push(watcher, watcher.onDidChange(reloadState), watcher.onDidCreate(reloadState));

  updateMeta();
}

/** Si el proveedor tiene página de claves, ofrece abrirla en el navegador antes de pedir la key. */
async function askApiKey(context: vscode.ExtensionContext, def: ProviderDef): Promise<string | undefined> {
  const hasKey = !!(await getApiKey(context, def.id));
  if (def.keyUrl && !hasKey) {
    const pick = await vscode.window.showInformationMessage(
      `Necesitas una API key de ${def.label}. Te llevo a la página para crearla y copiarla.`,
      { modal: true },
      'Abrir página de API keys',
      'Ya tengo una'
    );
    if (!pick) return undefined;
    if (pick === 'Abrir página de API keys') await vscode.env.openExternal(vscode.Uri.parse(def.keyUrl));
  }
  return vscode.window.showInputBox({
    title: `Pega tu API key — ${def.label}`,
    password: true,
    placeHolder: hasKey ? 'déjalo vacío para mantener la actual' : 'pega aquí la clave copiada',
    prompt: def.keyUrl ? `Se obtiene en ${def.keyUrl}` : undefined,
    ignoreFocusOut: true,
  });
}

async function pickProvider(): Promise<string | undefined> {
  const current = vscode.workspace.getConfiguration('tutor').get<string>('provider') || 'openai';
  const picks = PROVIDERS.map((p) => ({
    label: p.label,
    description: p.id === current ? '(actual)' : '',
    detail: p.nota,
    id: p.id,
  }));
  const pick = await vscode.window.showQuickPick(picks, {
    title: 'Proveedor de IA del tutor',
    placeHolder: 'ChatGPT, Claude, Gemini, OpenCode, Ollama, LM Studio…',
  });
  return pick?.id;
}


async function openChapterPreview(file: string): Promise<void> {
  try {
    const uri = vscode.Uri.file(file);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  } catch {
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
    } catch {
      vscode.window.showErrorMessage(`Tutor: no se pudo abrir ${file}`);
    }
  }
}

export function deactivate(): void {
  tutorContext = {};
}
