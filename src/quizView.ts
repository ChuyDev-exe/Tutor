import * as vscode from 'vscode';
import { a11yHead, registerWebview } from './a11y';
import { getNonce } from './md';
import { Chapter, Course, QuizItem, QuizQuestion } from './types';
import { gradeQuestion as grade } from './pure';
import { ChaptersProvider, quizPassed } from './chaptersProvider';
import { oneQuestionAtATime } from './a11y';

type Answer = number[] | string;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Imagen para el webview: URL https tal cual; archivo del curso → URI del webview. */
function imgUri(webview: vscode.Webview, p?: string): string | undefined {
  if (!p) return undefined;
  return /^https:\/\//i.test(p) ? p : webview.asWebviewUri(vscode.Uri.file(p)).toString();
}

const itemView = (webview: vscode.Webview, it: QuizItem) => ({ t: it.texto, img: imgUri(webview, it.imagen) });

interface PanelState {
  panel: vscode.WebviewPanel;
  shown: QuizQuestion[];
  practice: boolean;
}

/** Evaluación del capítulo: calificada en el host (las respuestas correctas nunca viajan al webview). */
export class QuizViewManager {
  private panels = new Map<string, PanelState>();

  constructor(private context: vscode.ExtensionContext, private chapters: ChaptersProvider) {}

  open(course: Course, chapter: Chapter): void {
    if (!chapter.evaluacion?.length) {
      vscode.window.showInformationMessage(`El capítulo «${chapter.titulo}» no tiene evaluación.`);
      return;
    }
    const key = `${course.id}/${chapter.id}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      this.start(existing, course, chapter);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'tutorQuiz',
      `Evaluación: ${chapter.titulo}`,
      vscode.ViewColumn.Active,
      // las imágenes de las preguntas solo pueden venir de la carpeta del curso (o de https)
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(course.root)] }
    );
    registerWebview(panel);
    const st: PanelState = { panel, shown: [], practice: false };
    this.panels.set(key, st);
    panel.webview.html = this.html(panel.webview);

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') this.start(st, course, chapter);
      else if (msg.type === 'grade') this.onGrade(st, course, chapter, msg.answers || {});
      else if (msg.type === 'retry') this.start(st, course, chapter);
      else if (msg.type === 'retryFailed') this.start(st, course, chapter, msg.ids);
    });
    panel.onDidDispose(() => this.panels.delete(key));
  }

  private start(st: PanelState, course: Course, chapter: Chapter, onlyIds?: string[]): void {
    let qs = chapter.evaluacion || [];
    st.practice = !!onlyIds?.length;
    if (onlyIds?.length) qs = qs.filter((q) => onlyIds.includes(q.id));
    if (chapter.barajar) qs = shuffle(qs);
    st.shown = qs;
    const rec = this.chapters.getQuiz(course.id, chapter.id);
    st.panel.webview.postMessage({
      type: 'state',
      titulo: chapter.titulo,
      curso: course.titulo,
      practice: st.practice,
      oneAtATime: oneQuestionAtATime(),
      aprobacion: chapter.aprobacion,
      requerida: chapter.evaluacionRequerida,
      best: rec?.mejor,
      intentos: (rec?.intentos ?? []).slice(-5).reverse(),
      // sin respuestas correctas; opciones mezcladas conservando su índice original (v)
      // arrastrar: elementos mezclados conservando su índice original (v); las zonas, en orden
      questions: qs.map((q) => ({
        id: q.id,
        tipo: q.tipo,
        pregunta: q.pregunta,
        codigo: q.codigo,
        img: imgUri(st.panel.webview, q.imagen),
        opciones: (chapter.barajar && q.tipo !== 'vf' ? shuffle(q.opciones.map((t, v) => ({ v, t }))) : q.opciones.map((t, v) => ({ v, t }))),
        zonas: (q.zonas ?? []).map((z) => itemView(st.panel.webview, z)),
        elementos: (() => {
          const els = (q.elementos ?? []).map((e, v) => ({ v, ...itemView(st.panel.webview, e) }));
          return chapter.barajar ? shuffle(els) : els;
        })(),
      })),
    });
  }

  private onGrade(st: PanelState, course: Course, chapter: Chapter, answers: Record<string, Answer>): void {
    const details = st.shown.map((q) => {
      const dada = answers[q.id];
      return {
        id: q.id,
        tipo: q.tipo,
        pregunta: q.pregunta,
        codigo: q.codigo,
        img: imgUri(st.panel.webview, q.imagen),
        opciones: q.opciones,
        zonas: (q.zonas ?? []).map((z) => itemView(st.panel.webview, z)),
        elementos: (q.elementos ?? []).map((e) => itemView(st.panel.webview, e)),
        dada: dada ?? (q.tipo === 'texto' ? '' : []),
        correctas: q.correctas,
        aceptadas: q.aceptadas,
        ok: grade(q, dada),
        explicacion: q.explicacion || '',
      };
    });
    const score = details.filter((d) => d.ok).length;
    const total = details.length;
    let best = this.chapters.getQuizScore(course.id, chapter.id);
    let intentos = this.chapters.getQuiz(course.id, chapter.id)?.intentos.length ?? 0;
    if (!st.practice) {
      // solo los intentos completos cuentan; la práctica de falladas no modifica el historial
      const rec = this.chapters.recordQuizAttempt(course, chapter, score, total);
      best = rec.mejor;
      intentos = rec.intentos.length;
    }
    st.panel.webview.postMessage({
      type: 'graded',
      details,
      score,
      total,
      practice: st.practice,
      passed: quizPassed(chapter, { score, total }),
      aprobacion: chapter.aprobacion,
      best,
      intentos,
      failedIds: details.filter((d) => !d.ok).map((d) => d.id),
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 20px 40px; line-height: 1.5; max-width: 820px; }
  h1 { font-size: 1.15em; margin: 0 0 4px; }
  .meta { opacity: .7; font-size: .9em; margin-bottom: 8px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .chip { font-size: .78em; padding: 1px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .bar { height: 6px; border-radius: 3px; background: rgba(127,127,127,.25); margin: 6px 0 14px; overflow: hidden; }
  .bar > div { height: 100%; background: var(--vscode-progressBar-background, #0e7afe); width: 0; transition: width .2s; }
  .q { border: 1px solid var(--vscode-panel-border, #555); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  .q .prompt { font-weight: 600; margin-bottom: 4px; }
  .q .hint { font-size: .8em; opacity: .65; margin-bottom: 6px; }
  pre { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); padding: 8px; border-radius: 6px; overflow: auto; margin: 6px 0; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  .opt { display: flex; gap: 8px; align-items: flex-start; padding: 4px 6px; cursor: pointer; border-radius: 4px; }
  .opt:hover { background: var(--vscode-list-hoverBackground); }
  .opt.correct { background: rgba(76,175,80,.14); }
  .opt.wrong { background: rgba(244,67,54,.12); }
  input[type=text] { width: 100%; box-sizing: border-box; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); border-radius: 4px; }
  .expl { margin-top: 6px; font-size: .9em; border-left: 3px solid var(--vscode-textLink-foreground, #4a9eff); padding-left: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 7px 16px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground, #555); color: var(--vscode-button-secondaryForeground, #fff); }
  .banner { padding: 10px 12px; border-radius: 6px; margin: 8px 0 14px; font-weight: 600; }
  .banner.ok { background: rgba(76,175,80,.15); color: var(--vscode-testing-iconPassed, #4caf50); }
  .banner.fail { background: rgba(244,67,54,.12); color: var(--vscode-testing-iconFailed, #f44336); }
  .banner.info { background: rgba(127,127,127,.15); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .q.hidden { display: none; }
  .hist { font-size: .85em; opacity: .8; margin-top: 14px; }
  .qimg { display: block; max-width: 100%; max-height: 300px; border-radius: 6px; margin: 6px 0; }
  .dnd .zones { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 8px; }
  .pool, .zone { border: 2px dashed var(--vscode-panel-border, rgba(127,127,127,.5)); border-radius: 8px; padding: 8px; min-height: 64px; }
  .zone { cursor: pointer; }
  .zone.over, .pool.over { border-color: var(--vscode-focusBorder, #0e7afe); background: var(--vscode-list-hoverBackground); }
  .zone:focus-visible, .item:focus-visible { outline: 2px solid var(--vscode-focusBorder, #0e7afe); outline-offset: 1px; }
  .zlabel { font-weight: 600; font-size: .9em; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
  .zlabel img { max-height: 40px; max-width: 80px; border-radius: 4px; }
  .items { display: flex; flex-wrap: wrap; gap: 6px; min-height: 28px; }
  .item { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; padding: 4px 9px; border-radius: 6px; cursor: grab; user-select: none;
          border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.5)); background: var(--vscode-editorWidget-background, rgba(127,127,127,.1)); }
  .item img { max-width: 96px; max-height: 72px; border-radius: 4px; pointer-events: none; }
  .item.sel { outline: 2px solid var(--vscode-focusBorder, #0e7afe); }
  .item.dragging { opacity: .4; }
  .item.correct { border-color: var(--vscode-testing-iconPassed, #4caf50); background: rgba(76,175,80,.14); cursor: default; }
  .item.wrong { border-color: var(--vscode-testing-iconFailed, #f44336); background: rgba(244,67,54,.12); cursor: default; }
  .item em { font-size: .8em; opacity: .85; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
${a11yHead(nonce)}
</head>
<body>
  <h1 id="titulo">Evaluación</h1>
  <div class="meta" id="meta"></div>
  <div class="chips" id="chips"></div>
  <div id="body"></div>
  <div id="live" class="sr" aria-live="polite"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let questions = [];
  let last = null;
  let posLabel = '';

  const typeHint = { unica: 'Elige una opción', multiple: 'Marca todas las correctas', vf: 'Verdadero o falso', texto: 'Escribe tu respuesta',
    arrastrar: 'Arrastra cada elemento a su zona (o selecciónalo con clic / Enter y luego elige la zona)' };

  const itemHtml = (it) => (it.img ? '<img src="' + esc(it.img) + '" alt="' + esc(it.t || 'imagen') + '">' : '') + (it.t ? '<span>' + esc(it.t) + '</span>' : '');
  const qImg = (q) => q.img ? '<img class="qimg" src="' + esc(q.img) + '" alt="Imagen de la pregunta">' : '';

  function readAnswers() {
    const out = {};
    questions.forEach((q, i) => {
      if (q.tipo === 'texto') out[q.id] = (document.querySelector('#t' + i) || {}).value || '';
      else if (q.tipo === 'arrastrar') {
        const arr = q.elementos.map(() => -1);
        document.querySelectorAll('.item[data-q="' + i + '"]').forEach(el => {
          arr[Number(el.dataset.v)] = Number(el.closest('[data-zone]').dataset.zone);
        });
        out[q.id] = arr;
      }
      else out[q.id] = [...document.querySelectorAll('input[name="q' + i + '"]:checked')].map(x => Number(x.value));
    });
    return out;
  }
  function answered() {
    const a = readAnswers();
    return questions.filter(q => q.tipo === 'texto' ? String(a[q.id]).trim()
      : q.tipo === 'arrastrar' ? a[q.id].every(z => z >= 0) : a[q.id].length).length;
  }

  // ---- arrastrar: drag & drop nativo + selección con clic o teclado ----
  let selected = null, dragging = null;
  function selectItem(el) {
    if (selected) { selected.classList.remove('sel'); selected.setAttribute('aria-pressed', 'false'); }
    selected = selected === el ? null : el;
    if (selected) { selected.classList.add('sel'); selected.setAttribute('aria-pressed', 'true'); }
  }
  function moveTo(el, target) {
    if (!el || !target || el.dataset.q !== target.dataset.q) return;
    target.querySelector('.items').appendChild(el);
    if (selected) selectItem(selected);
    const name = target.dataset.zone === '-1' ? 'elementos sin colocar' : target.getAttribute('aria-label');
    $('live').textContent = '«' + (el.textContent || 'imagen') + '» → ' + name;
    updateBar();
  }
  function wireDnd(root) {
    root.querySelectorAll('.item').forEach(el => {
      el.addEventListener('dragstart', (e) => { dragging = el; el.classList.add('dragging'); e.dataTransfer.setData('text/plain', el.dataset.v); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragging = null; });
      el.addEventListener('click', (e) => { e.stopPropagation(); selectItem(el); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectItem(el); } });
    });
    root.querySelectorAll('[data-zone]').forEach(z => {
      z.addEventListener('dragover', (e) => { if (dragging && dragging.dataset.q === z.dataset.q) { e.preventDefault(); z.classList.add('over'); } });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); moveTo(dragging, z); });
      z.addEventListener('click', () => moveTo(selected, z));
      z.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === z) { e.preventDefault(); moveTo(selected, z); } });
    });
  }
  function dndHtml(q, i) {
    const items = q.elementos.map(e =>
      '<div class="item" draggable="true" tabindex="0" role="button" aria-pressed="false" data-q="' + i + '" data-v="' + e.v + '">' + itemHtml(e) + '</div>').join('');
    const zones = q.zonas.map((z, k) =>
      '<div class="zone" tabindex="0" role="button" data-q="' + i + '" data-zone="' + k + '" aria-label="' + esc(z.t || 'zona ' + (k + 1)) + '">' +
        '<div class="zlabel">' + itemHtml(z) + '</div><div class="items"></div></div>').join('');
    return '<div class="dnd"><div class="pool" data-q="' + i + '" data-zone="-1" aria-label="elementos sin colocar"><div class="zlabel">Elementos</div><div class="items">' + items + '</div></div>' +
      '<div class="zones">' + zones + '</div></div>';
  }
  function updateBar() {
    const n = answered();
    $('bar').firstElementChild.style.width = (questions.length ? n / questions.length * 100 : 0) + '%';
    $('count').textContent = (posLabel ? posLabel + ' · ' : '') + n + '/' + questions.length + ' respondidas';
  }

  function renderQuiz(msg) {
    questions = msg.questions;
    posLabel = '';
    $('titulo').textContent = (msg.practice ? '🔁 Práctica: ' : '📝 Evaluación: ') + msg.titulo;
    $('meta').textContent = msg.curso;
    $('chips').innerHTML =
      '<span class="chip">' + questions.length + ' pregunta(s)</span>' +
      '<span class="chip">aprobación ≥ ' + msg.aprobacion + '%</span>' +
      (msg.requerida ? '<span class="chip">obligatoria para completar el capítulo</span>' : '') +
      (msg.best ? '<span class="chip">mejor: ' + msg.best.score + '/' + msg.best.total + '</span>' : '');
    let html = msg.practice ? '<div class="banner info">Práctica de las preguntas falladas: no modifica tu puntaje ni tu historial.</div>' : '';
    html += '<div class="bar" id="bar"><div></div></div>';
    html += questions.map((q, i) => {
      let body;
      if (q.tipo === 'texto') body = '<input type="text" id="t' + i + '" placeholder="Tu respuesta…" autocomplete="off">';
      else if (q.tipo === 'arrastrar') body = dndHtml(q, i);
      else body = q.opciones.map(o =>
        '<label class="opt"><input type="' + (q.tipo === 'multiple' ? 'checkbox' : 'radio') + '" name="q' + i + '" value="' + o.v + '"> <span>' + esc(o.t) + '</span></label>').join('');
      return '<div class="q"><div class="prompt">' + (i + 1) + '. ' + esc(q.pregunta) + '</div>' +
        '<div class="hint">' + typeHint[q.tipo] + '</div>' + qImg(q) +
        (q.codigo ? '<pre><code>' + esc(q.codigo) + '</code></pre>' : '') + body + '</div>';
    }).join('');
    html += '<div class="row">' +
      (msg.oneAtATime ? '<button id="prevBtn" class="secondary">← Anterior</button><button id="nextBtn" class="secondary">Siguiente →</button>' : '') +
      '<button id="gradeBtn">Calificar</button><span class="meta" id="count" style="align-self:center"></span></div>';
    if (msg.intentos.length && !msg.practice) {
      html += '<div class="hist">Últimos intentos: ' + msg.intentos.map(a =>
        (a.aprobado ? '✅' : '❌') + ' ' + a.score + '/' + a.total + ' (' + new Date(a.fecha).toLocaleDateString() + ')').join(' · ') + '</div>';
    }
    $('body').innerHTML = html;
    $('gradeBtn').addEventListener('click', () => {
      if (answered() < questions.length && !confirm('Hay preguntas sin responder. ¿Calificar de todos modos?')) return;
      vscode.postMessage({ type: 'grade', answers: readAnswers() });
    });
    $('body').oninput = $('body').onchange = updateBar;
    selected = null;
    wireDnd($('body'));
    updateBar();
    if (msg.oneAtATime) {
      let cur = 0;
      const qs = [...document.querySelectorAll('.q')];
      const show = () => {
        qs.forEach((el, i) => el.classList.toggle('hidden', i !== cur));
        $('prevBtn').disabled = cur === 0;
        $('nextBtn').disabled = cur === qs.length - 1;
        $('gradeBtn').style.display = cur === qs.length - 1 ? '' : 'none';
        posLabel = 'Pregunta ' + (cur + 1) + ' de ' + qs.length;
        updateBar();
      };
      $('prevBtn').addEventListener('click', () => { cur = Math.max(0, cur - 1); show(); });
      $('nextBtn').addEventListener('click', () => { cur = Math.min(qs.length - 1, cur + 1); show(); });
      show();
    }
    window.scrollTo(0, 0);
  }

  function fmtGiven(d) {
    if (d.tipo === 'texto') return d.dada ? esc(d.dada) : '<em>(vacío)</em>';
    return d.dada.length ? d.dada.map(i => esc(d.opciones[i])).join(', ') : '<em>(sin responder)</em>';
  }

  // cada zona con lo que el alumno dejó en ella; lo mal colocado indica su zona correcta
  function dndResult(d) {
    const given = Array.isArray(d.dada) ? d.dada : [];
    const chip = (e, j) => {
      const ok = given[j] === d.correctas[j];
      return '<div class="item ' + (ok ? 'correct' : 'wrong') + '">' + itemHtml(e) +
        (ok ? '' : '<em>va en «' + esc(d.zonas[d.correctas[j]].t || 'zona ' + (d.correctas[j] + 1)) + '»</em>') + '</div>';
    };
    const inZone = (k) => d.elementos.map((e, j) => given[j] === k ? chip(e, j) : '').join('');
    const loose = inZone(-1) + d.elementos.map((e, j) => given[j] === undefined ? chip(e, j) : '').join('');
    return '<div class="dnd">' + (loose ? '<div class="pool"><div class="zlabel">Sin colocar</div><div class="items">' + loose + '</div></div>' : '') +
      '<div class="zones">' + d.zonas.map((z, k) =>
        '<div class="zone"><div class="zlabel">' + itemHtml(z) + '</div><div class="items">' + inZone(k) + '</div></div>').join('') + '</div></div>';
  }

  function renderResult(msg) {
    const head = '<div class="banner ' + (msg.passed ? 'ok' : 'fail') + '">' + (msg.passed ? '✓ ' : '✗ ') +
      msg.score + '/' + msg.total + ' (' + Math.round(msg.score / msg.total * 100) + '%) — ' +
      (msg.passed ? '¡Aprobada!' : 'se requiere ≥ ' + msg.aprobacion + '%') +
      (msg.practice ? ' · práctica (no cuenta)' : (msg.best ? ' · mejor: ' + msg.best.score + '/' + msg.best.total + ' · ' + msg.intentos + ' intento(s)' : '')) + '</div>';
    const items = msg.details.map((d, i) => {
      let body;
      if (d.tipo === 'arrastrar') {
        body = dndResult(d);
      } else if (d.tipo === 'texto') {
        body = '<div class="opt ' + (d.ok ? 'correct' : 'wrong') + '"><span>Tu respuesta: ' + fmtGiven(d) + '</span></div>' +
          (d.ok ? '' : '<div class="opt correct"><span>Aceptadas: ' + d.aceptadas.map(esc).join(' · ') + '</span></div>');
      } else {
        body = d.opciones.map((o, j) => {
          const isRight = d.correctas.includes(j), chosen = d.dada.includes(j);
          const cls = isRight ? 'correct' : (chosen ? 'wrong' : '');
          const mark = isRight ? (chosen ? '✓ correcta' : '✓ era correcta') : (chosen ? '✗ tu respuesta' : '');
          return '<div class="opt ' + cls + '"><span>' + esc(o) + '</span> <em>' + mark + '</em></div>';
        }).join('');
      }
      return '<div class="q"><div class="prompt">' + (d.ok ? '✅ ' : '❌ ') + (i + 1) + '. ' + esc(d.pregunta) + '</div>' + qImg(d) +
        (d.codigo ? '<pre><code>' + esc(d.codigo) + '</code></pre>' : '') + body +
        (d.explicacion ? '<div class="expl">' + esc(d.explicacion) + '</div>' : '') + '</div>';
    }).join('');
    last = msg;
    $('body').innerHTML = head + items + '<div class="row"><button id="retryBtn" class="secondary">Reintentar todo</button>' +
      (msg.failedIds.length ? '<button id="failBtn">Repetir solo las ' + msg.failedIds.length + ' falladas</button>' : '') + '</div>';
    $('retryBtn').addEventListener('click', () => vscode.postMessage({ type: 'retry' }));
    if (msg.failedIds.length) $('failBtn').addEventListener('click', () => vscode.postMessage({ type: 'retryFailed', ids: msg.failedIds }));
    window.scrollTo(0, 0);
  }

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') renderQuiz(e.data);
    else if (e.data.type === 'graded') renderResult(e.data);
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
