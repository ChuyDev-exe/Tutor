import * as vscode from 'vscode';
import { a11yHead, registerWebview } from './a11y';
import { getNonce } from './md';
import { TestReport, RunResult } from './runner';
import { Chapter, Course } from './types';
import { quizPassed } from './chaptersProvider';

type ResultsPayload =
  | { mode: 'html'; titulo: string; html: string; curso: string; capitulo: string }
 
  | { mode: 'run'; titulo: string; curso: string; capitulo: string; result: RunResult }
  | { mode: 'tests'; titulo: string; curso: string; capitulo: string; report: TestReport }
  | {
      mode: 'quiz';
      titulo: string;
      curso: string;
      capitulo: string;
      preguntas: number;
      best?: { score: number; total: number };
      passed: boolean;
      aprobacion: number;
    };

/**
 * Panel en una tab del editor que muestra resultados:
 * salida de código ejecutado, reporte de pruebas o resumen del cuestionario,
 * según el tipo de curso/ejercicio activo.
 */
export class ResultsViewManager {
  private panel?: vscode.WebviewPanel;
  private last?: ResultsPayload;

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'tutorResults',
      'Tutor: Resultados',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    registerWebview(this.panel);
    this.panel.webview.html = this.html(this.panel.webview);
    if (this.last) this.panel.webview.postMessage({ type: 'payload', payload: this.serialize(this.last) });
    this.panel.onDidDispose(() => (this.panel = undefined));
  }

  showRun(exercise: { titulo: string }, curso: string, capitulo: string, result: RunResult): void {
    this.last = { mode: 'run', titulo: exercise.titulo, curso, capitulo, result };
    this.push();
  }

  showTests(exercise: { titulo: string }, curso: string, capitulo: string, report: TestReport): void {
    this.last = { mode: 'tests', titulo: exercise.titulo, curso, capitulo, report };
    this.push();
  }

  showHtml(titulo: string, html: string): void {
    this.last = { mode: 'html', titulo, html, curso: '', capitulo: '' };
    this.push();
  }

  showQuizInfo(course: Course, chapter: Chapter, best?: { score: number; total: number }): void {
    this.last = {
      mode: 'quiz',
      titulo: chapter.titulo,
      curso: course.titulo,
      capitulo: chapter.titulo,
      preguntas: chapter.evaluacion?.length ?? 0,
      best,
      passed: quizPassed(chapter, best),
      aprobacion: chapter.aprobacion,
    };
    this.push();
  }

  private push(): void {
    this.open();
    if (this.panel && this.last) {
      this.panel.webview.postMessage({ type: 'payload', payload: this.serialize(this.last) });
    }
  }

  private serialize(p: ResultsPayload): any {
    return JSON.parse(JSON.stringify(p));
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px 20px; line-height: 1.5; }
  h1 { font-size: 1.15em; margin: 0 0 4px; }
  .meta { opacity: .7; font-size: .9em; margin-bottom: 14px; }
  .banner { padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; font-weight: 600; }
  .banner.ok { background: rgba(76,175,80,.15); color: var(--vscode-testing-iconPassed, #4caf50); }
  .banner.fail { background: rgba(244,67,54,.12); color: var(--vscode-testing-iconFailed, #f44336); }
  .case { border: 1px solid var(--vscode-panel-border, #555); border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
  .case header { padding: 6px 10px; font-weight: 600; display: flex; gap: 8px; align-items: center; }
  .case header.ok { background: rgba(76,175,80,.12); }
  .case header.fail { background: rgba(244,67,54,.1); }
  .case .body { padding: 8px 10px; }
  .label { opacity: .65; font-size: .85em; text-transform: uppercase; letter-spacing: .04em; }
  pre { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); padding: 8px; border-radius: 4px; overflow: auto; white-space: pre-wrap; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  td, th { border: 1px solid var(--vscode-panel-border, #555); padding: 5px 8px; text-align: left; font-size: .92em; }
  .empty { opacity: .6; }
  .bar { height: 8px; border-radius: 4px; background: rgba(127,127,127,.25); overflow: hidden; margin: 4px 0 10px; }
  .bar > div { height: 100%; background: var(--vscode-progressBar-background, #0e7afe); }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .card { flex: 1; min-width: 120px; border: 1px solid var(--vscode-panel-border, #555); border-radius: 8px; padding: 10px 12px; }
  .card b { display: block; font-size: 1.6em; }
  h2 { font-size: 1.05em; margin: 18px 0 4px; }
  ul { padding-left: 18px; }
</style>
${a11yHead(nonce)}
</head>
<body>
  <div id="root"><p class="empty">Ejecuta código, corre las pruebas o abre una evaluación para ver resultados aquí.</p></div>
<script nonce="${nonce}">
  const root = document.getElementById('root');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  window.addEventListener('message', (e) => {
    if (e.data.type !== 'payload') return;
    const p = e.data.payload;
    const meta = esc(p.curso) + ' → ' + esc(p.capitulo);
    if (p.mode === 'html') {
      root.innerHTML = p.html;
    } else if (p.mode === 'run') {
      const r = p.result;
      root.innerHTML =
        '<h1>▶ Ejecución: ' + esc(p.titulo) + '</h1><div class="meta">' + meta + ' · ' + r.durationMs + ' ms</div>' +
        (r.ok
          ? '<div class="banner ok">✓ Ejecución correcta (código de salida ' + r.exitCode + ')</div>'
          : '<div class="banner fail">✗ ' + esc(r.error || 'Error en la ejecución (código ' + r.exitCode + ')') + '</div>') +
        (r.stdout ? '<div class="label">Salida (stdout)</div><pre>' + esc(r.stdout) + '</pre>' : '') +
        (r.stderr ? '<div class="label">Errores (stderr)</div><pre>' + esc(r.stderr) + '</pre>' : '');
    } else if (p.mode === 'tests') {
      const t = p.report;
      let head =
        '<h1>🧪 Pruebas: ' + esc(p.titulo) + '</h1><div class="meta">' + meta + ' · ' + t.durationMs + ' ms</div>';
      if (t.kind === 'command') {
        head += (t.passed ? '<div class="banner ok">✓ Comando de pruebas aprobado</div>'
                          : '<div class="banner fail">✗ Comando de pruebas falló</div>') +
                '<div class="label">Salida del comando</div><pre>' + esc(t.output || '') + '</pre>';
      } else if (!t.cases || !t.cases.length) {
        head += '<div class="banner fail">Sin casos de prueba</div><pre>' + esc(t.output || '') + '</pre>';
      } else {
        head += (t.passed === t.total && t.total > 0
          ? '<div class="banner ok">✓ ' + t.passed + '/' + t.total + ' pruebas superadas</div>'
          : '<div class="banner fail">✗ ' + t.passed + '/' + t.total + ' pruebas superadas</div>');
        head += '<table><tr><th></th><th>Caso</th><th>Esperado</th><th>Obtenido</th></tr>' +
          t.cases.map((c) =>
            '<tr><td>' + (c.ok ? '✅' : '❌') + '</td><td>' + esc(c.nombre) + '</td><td><code>' + esc(c.esperado) +
            '</code></td><td><code>' + esc(c.obtenido) + '</code></td></tr>' +
            (c.stderr ? '<tr><td></td><td colspan="3"><pre>' + esc(c.stderr) + '</pre></td></tr>' : '')
          ).join('') + '</table>';
      }
      root.innerHTML = head;
    } else if (p.mode === 'quiz') {
      root.innerHTML =
        '<h1>📝 Evaluación: ' + esc(p.titulo) + '</h1><div class="meta">' + meta + '</div>' +
        (p.best
          ? (p.passed
              ? '<div class="banner ok">✓ Aprobada — mejor puntaje: ' + p.best.score + '/' + p.best.total + '</div>'
              : '<div class="banner fail">✗ Aún no aprobada (se requiere ≥ ' + p.aprobacion + '%). Mejor: ' + p.best.score + '/' + p.best.total + '</div>')
          : '<div class="banner fail">Aún no has intentado esta evaluación (' + p.preguntas + ' pregunta(s))</div>') +
        '<p>Abre la evaluación desde el árbol de capítulos (nodo 📝 Evaluación) o desde el botón de la barra de estado para responder las preguntas de opción múltiple.</p>';
    }
  });
</script>
</body>
</html>`;
  }
}
