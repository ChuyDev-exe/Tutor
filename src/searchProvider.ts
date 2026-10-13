import * as vscode from 'vscode';
import { a11yHead, registerWebview } from './a11y';
import { getNonce } from './md';
import { searchLocal } from './content';
import { cachedEntry, downloadCourse, listRepoCourses, loadSummary } from './repo';
import { RepoCourseEntry } from './types';
import { compareVersions, formatMinutes } from './pure';

type Estado = 'nuevo' | 'instalado' | 'actualizar';

/**
 * Vista lateral con dos pestañas:
 *  - "Repositorio": lista los cursos del repositorio (GitHub o catalogo.json); al elegir uno se abre
 *    una ficha con su temario, duración y requisitos, y desde ahí se descarga al workspace.
 *  - "Clases": búsqueda full-text en los cursos instalados.
 */
export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tutorSearch';
  private view?: vscode.WebviewView;
  private lastQuery = '';

  constructor(
    private context: vscode.ExtensionContext,
    private getChaptersProvider: () => {
      reload: () => void;
      allCourses: import('./types').Course[];
      isUnlocked: (courseId: string, index: number) => boolean;
    }
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    registerWebview(view);
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            await this.searchRepo('');
            break;
          case 'searchRepo':
            await this.searchRepo(String(msg.query ?? ''), !!msg.force);
            break;
          case 'details':
            await this.details(String(msg.id));
            break;
          case 'download': {
            // el webview solo manda el id: rutas y URLs salen de la lista que leyó el host
            const entry = cachedEntry(String(msg.id));
            if (!entry) throw new Error('El curso ya no está en la lista; vuelve a buscar.');
            await this.download(entry);
            break;
          }
          case 'openWeb': {
            const url = cachedEntry(String(msg.id))?.webUrl;
            if (url && /^https:\/\/github\.com\//.test(url)) void vscode.env.openExternal(vscode.Uri.parse(url));
            break;
          }
          case 'searchLocal':
            this.searchClasses(msg.query);
            break;
          case 'open': {
            const courses = this.getChaptersProvider().allCourses;
            const course = courses.find((c) => c.id === msg.courseId);
            if (!course) return;
            if (msg.kind === 'exercise') {
              const ch = course.capitulos.find((c) => c.id === msg.chapterId);
              const ex = ch?.ejercicios.find((e) => e.id === msg.exerciseId);
              if (ch && ex) vscode.commands.executeCommand('tutor.openExercise', course, ch, ex);
            } else {
              const ch = course.capitulos.find((c) => c.id === msg.chapterId);
              if (ch) vscode.commands.executeCommand('tutor.openChapter', course, ch);
            }
            break;
          }
          case 'openSettings':
            vscode.commands.executeCommand('workbench.action.openSettings', 'tutor.repo');
            break;
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        view.webview.postMessage({ type: 'error', text, id: msg?.id });
      }
    });
  }

  private estado(c: RepoCourseEntry): Estado {
    const have = this.getChaptersProvider().allCourses.find((x) => x.id === c.id);
    if (!have) return 'nuevo';
    return c.version && (!have.version || compareVersions(c.version, have.version) > 0) ? 'actualizar' : 'instalado';
  }

  /** Lo que el webview necesita de un curso (sin rutas ni URLs de descarga). */
  private card(c: RepoCourseEntry) {
    const r = c.resumen;
    return {
      id: c.id,
      titulo: c.titulo,
      descripcion: c.descripcion || '',
      nivel: c.nivel || '',
      tags: c.tags || [],
      version: c.version || '',
      estado: this.estado(c),
      duracion: r ? formatMinutes(r.minutos) : '',
      capitulos: r?.capitulos.length ?? 0,
      web: !!c.webUrl,
    };
  }

  private async searchRepo(query: string, force = false): Promise<void> {
    this.lastQuery = query;
    this.view?.webview.postMessage({ type: 'status', text: 'Leyendo cursos del repositorio…', replace: true });
    let listing;
    try {
      listing = await listRepoCourses(force);
    } catch (err) {
      this.view?.webview.postMessage({
        type: 'repoResults',
        error: err instanceof Error ? err.message : String(err),
        needsConfig: /Configura|debe|tutor\.repo/.test(String(err)),
        results: [],
      });
      return;
    }
    const q = query.toLowerCase().trim();
    const results = listing.cursos.filter(
      (c) =>
        !q ||
        c.titulo.toLowerCase().includes(q) ||
        (c.descripcion || '').toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (c.nivel || '').toLowerCase().includes(q) ||
        (c.resumen?.capitulos ?? []).some((ch) => ch.titulo.toLowerCase().includes(q))
    );
    this.view?.webview.postMessage({
      type: 'repoResults',
      repoName: listing.nombre,
      aviso: listing.aviso,
      results: results.map((c) => this.card(c)),
    });
  }

  private async details(id: string): Promise<void> {
    const entry = cachedEntry(id);
    if (!entry) throw new Error('El curso ya no está en la lista; vuelve a buscar.');
    const full = await loadSummary(entry);
    const r = full.resumen!;
    this.view?.webview.postMessage({
      type: 'details',
      course: {
        ...this.card(full),
        duracion: formatMinutes(r.minutos),
        ejercicios: r.ejercicios,
        preguntas: r.preguntas,
        requisitos: r.requisitos,
        lenguajes: r.lenguajes,
        temario: r.capitulos.map((ch) => ({ ...ch, duracion: formatMinutes(ch.minutos ?? 0) })),
      },
    });
  }

  private async download(entry: RepoCourseEntry): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error('Abre una carpeta de trabajo (workspace) para descargar el curso.');
    }
    const isUpdate = this.getChaptersProvider().allCourses.some((c) => c.id === entry.id);
    await downloadCourse(entry);
    this.getChaptersProvider().reload();
    void vscode.commands.executeCommand('tutor.courseInstalled', entry.id, isUpdate);
    this.view?.webview.postMessage({
      type: 'downloaded',
      id: entry.id,
      estado: this.estado(entry),
      text: `Curso "${entry.titulo}" ${isUpdate ? 'actualizado' : 'descargado'}.`,
    });
    await this.searchRepo(this.lastQuery);
  }

  private searchClasses(query: string): void {
    const prov = this.getChaptersProvider();
    // los capítulos bloqueados no aparecen en la búsqueda (no se filtra su contenido)
    const visible = prov.allCourses.map((c) => ({
      ...c,
      capitulos: c.capitulos.filter((ch) => prov.isUnlocked(c.id, c.capitulos.indexOf(ch))),
    }));
    const results = searchLocal(query, visible).map((r) => ({
      kind: r.kind,
      courseId: r.course.id,
      courseTitle: r.course.titulo,
      chapterId: r.chapter.id,
      chapterTitle: r.chapter.titulo,
      exerciseId: r.exercise?.id || '',
      title: r.kind === 'chapter' ? r.chapter.titulo : r.exercise?.titulo || '',
      snippet: r.snippet,
      tags: r.chapter.tags,
    }));
    this.view?.webview.postMessage({ type: 'localResults', results });
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 6px 8px; margin: 0; }
  .tabs { display: flex; gap: 12px; margin-bottom: 6px; border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3)); }
  .tab { padding: 2px 0 4px; cursor: pointer; opacity: .6; border-bottom: 2px solid transparent; font-size: .9em; }
  .tab:hover { opacity: .9; }
  .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder, var(--vscode-textLink-foreground)); }
  .row { display: flex; gap: 4px; }
  input { flex: 1; min-width: 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 7px; border-radius: 4px; font-family: inherit; font-size: inherit; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: transparent; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 9px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { background: none; color: var(--vscode-descriptionForeground); cursor: default; }
  button.small { padding: 1px 7px; font-size: .8em; flex: none; }
  button.secondary { background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.25)); color: var(--vscode-button-secondaryForeground, inherit); }
  button.icon { background: none; color: var(--vscode-foreground); opacity: .7; padding: 2px 6px; }
  button.icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.2)); }
  .card { padding: 6px 4px; border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.2)); }
  .card.clickable { cursor: pointer; }
  .card.clickable:hover { background: var(--vscode-list-hoverBackground); }
  .card:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .t { font-weight: 600; }
  .d, .s { opacity: .75; font-size: .85em; margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tags { margin-top: 3px; display: flex; gap: 3px; flex-wrap: wrap; }
  .tag { font-size: .7em; opacity: .75; border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.4)); padding: 0 5px; border-radius: 8px; }
  .tag.ok { opacity: 1; border-color: var(--vscode-testing-iconPassed, #4caf50); color: var(--vscode-testing-iconPassed, #4caf50); }
  .tag.up { opacity: 1; border-color: var(--vscode-notificationsInfoIcon-foreground, #3794ff); color: var(--vscode-notificationsInfoIcon-foreground, #3794ff); }
  .card-head { display: flex; justify-content: space-between; gap: 6px; align-items: flex-start; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .status { margin: 6px 0 2px; opacity: .65; font-size: .8em; }
  .error { margin-top: 6px; color: var(--vscode-errorForeground); font-size: .9em; }
  .empty { opacity: .55; margin-top: 8px; font-size: .85em; }
  a { color: var(--vscode-textLink-foreground); }

  /* ficha del curso */
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: flex-start; justify-content: center; padding: 10px 6px; z-index: 10; }
  .modal[hidden] { display: none; }
  .sheet { background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); color: var(--vscode-foreground);
           border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.4))); border-radius: 8px;
           box-shadow: 0 4px 18px rgba(0,0,0,.35); width: 100%; max-width: 560px; max-height: calc(100vh - 20px); overflow: auto; padding: 12px 12px 14px; }
  .sheet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .sheet h2 { font-size: 1.1em; margin: 0 0 4px; }
  .sheet h3 { font-size: .8em; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin: 14px 0 6px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; margin: 10px 0 4px; }
  .stat { border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3)); border-radius: 6px; padding: 5px 7px; }
  .stat b { display: block; font-size: 1.05em; }
  .stat span { font-size: .75em; opacity: .7; }
  .desc { margin: 8px 0 0; line-height: 1.45; }
  .temario { margin: 0; padding-left: 20px; }
  .temario li { margin-bottom: 7px; }
  .temario .ct { font-weight: 600; }
  .temario .cm { font-size: .78em; opacity: .7; }
  .temario .cd { font-size: .85em; opacity: .8; margin-top: 1px; }
  .reqs { margin: 0; padding-left: 18px; font-size: .9em; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; position: sticky; bottom: -14px; padding: 8px 0; background: inherit; }
  .actions button { padding: 5px 12px; }
</style>
${a11yHead(nonce)}
</head>
<body>
  <div class="tabs" role="tablist">
    <div class="tab active" id="tabRepo" role="tab" tabindex="0">Repositorio</div>
    <div class="tab" id="tabLocal" role="tab" tabindex="0">Clases</div>
  </div>

  <div id="panelRepo">
    <div class="row">
      <input id="repoQ" type="text" placeholder="Filtrar cursos…" aria-label="Filtrar cursos" />
      <button id="repoGo">Buscar</button>
    </div>
    <div id="repoOut"><div class="status">Cargando cursos…</div></div>
  </div>

  <div id="panelLocal" style="display:none">
    <div class="row">
      <input id="localQ" type="text" placeholder="Buscar clases y ejercicios…" aria-label="Buscar clases y ejercicios" />
      <button id="localGo">Buscar</button>
    </div>
    <div id="localOut"><div class="empty">Busca en tus cursos instalados.</div></div>
  </div>

  <div id="modal" class="modal" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <div class="sheet-head">
        <h2 id="mTitle"></h2>
        <button class="icon" id="mClose" aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
      </div>
      <div id="mBody"></div>
    </div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let results = [];
  let openId = null;
  let lastFocus = null;

  function showTab(which) {
    $('tabRepo').classList.toggle('active', which === 'repo');
    $('tabLocal').classList.toggle('active', which === 'local');
    $('panelRepo').style.display = which === 'repo' ? '' : 'none';
    $('panelLocal').style.display = which === 'local' ? '' : 'none';
  }
  for (const [id, which] of [['tabRepo', 'repo'], ['tabLocal', 'local']]) {
    $(id).addEventListener('click', () => showTab(which));
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTab(which); } });
  }

  const search = (force) => vscode.postMessage({ type: 'searchRepo', query: $('repoQ').value, force: !!force });
  $('repoGo').addEventListener('click', () => search(false));
  $('repoQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(false); });

  $('localGo').addEventListener('click', () => {
    const q = $('localQ').value.trim();
    if (q) vscode.postMessage({ type: 'searchLocal', query: q });
  });
  $('localQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('localGo').click(); });

  const stateTag = (c) => c.estado === 'instalado' ? '<span class="tag ok">instalado</span>'
    : c.estado === 'actualizar' ? '<span class="tag up">actualización v' + esc(c.version) + '</span>' : '';
  const actionLabel = (c) => c.estado === 'instalado' ? 'Instalado'
    : c.estado === 'actualizar' ? 'Actualizar' + (c.version ? ' a v' + esc(c.version) : '') : 'Descargar';

  function renderList(msg) {
    results = msg.results;
    const header = '<div class="bar"><div class="status">' + esc(msg.repoName) + ' · ' + results.length + ' curso(s)</div>' +
      '<button class="icon small" id="refresh" title="Volver a leer el repositorio" aria-label="Volver a leer el repositorio">↻</button></div>';
    const body = !results.length ? '<div class="empty">Sin resultados.</div>' : results.map((c, i) =>
      '<div class="card clickable" tabindex="0" role="button" data-idx="' + i + '" aria-label="Ver ficha de ' + esc(c.titulo) + '">' +
        '<div class="card-head"><div>' +
          '<div class="t">' + esc(c.titulo) + '</div>' +
          '<div class="d">' + esc(c.descripcion) + '</div>' +
          '<div class="tags">' + stateTag(c) +
            [c.nivel, c.duracion ? '⏱ ' + c.duracion : '', c.capitulos ? c.capitulos + ' capítulos' : ''].filter(Boolean).map(t => '<span class="tag">' + esc(t) + '</span>').join('') +
          '</div>' +
        '</div>' +
        (c.estado === 'instalado' ? '' : '<button class="small" data-dl="' + i + '">' + actionLabel(c) + '</button>') +
      '</div></div>'
    ).join('');
    $('repoOut').innerHTML = (msg.aviso ? '<div class="error">' + esc(msg.aviso) + '</div>' : '') + header + body;
    $('refresh').addEventListener('click', () => search(true));
    $('repoOut').querySelectorAll('.card').forEach(el => {
      const open = () => openDetails(results[Number(el.dataset.idx)].id, el);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); open(); } });
    });
    $('repoOut').querySelectorAll('button[data-dl]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); download(results[Number(btn.dataset.dl)].id, btn); })
    );
  }

  function download(id, btn) {
    document.querySelectorAll('button[data-dl], #mDownload').forEach(b => {
      const bid = b.id === 'mDownload' ? openId : results[Number(b.dataset.dl)]?.id;
      if (bid === id) { b.textContent = 'Descargando…'; b.disabled = true; }
    });
    vscode.postMessage({ type: 'download', id });
  }

  // ---- ficha del curso (modal) ----
  function openDetails(id, from) {
    openId = id;
    lastFocus = from || document.activeElement;
    const c = results.find(r => r.id === id) || {};
    $('mTitle').textContent = c.titulo || '';
    $('mBody').innerHTML = '<div class="status">Cargando temario…</div>';
    $('modal').hidden = false;
    $('mClose').focus();
    vscode.postMessage({ type: 'details', id });
  }
  function closeModal() {
    $('modal').hidden = true;
    openId = null;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  $('mClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if ($('modal').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    if (e.key === 'Tab') {
      // el foco no sale de la ficha mientras está abierta
      const f = [...$('modal').querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function renderDetails(c) {
    if (c.id !== openId) return;
    $('mTitle').textContent = c.titulo;
    const stat = (v, label) => '<div class="stat"><b>' + esc(v) + '</b><span>' + label + '</span></div>';
    const temario = c.temario.map(ch =>
      '<li><div class="ct">' + esc(ch.titulo) + '</div>' +
        '<div class="cm">' + [ch.duracion, ch.ejercicios ? ch.ejercicios + ' ejercicio(s)' : '', ch.preguntas ? 'evaluación de ' + ch.preguntas + ' pregunta(s)' : '']
          .filter(Boolean).map(esc).join(' · ') + '</div>' +
        (ch.descripcion ? '<div class="cd">' + esc(ch.descripcion) + '</div>' : '') +
      '</li>').join('');
    $('mBody').innerHTML =
      '<div class="tags">' + stateTag(c) + [c.nivel, c.version ? 'v' + c.version : ''].concat(c.lenguajes).filter(Boolean)
        .map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
      '<div class="stats">' +
        stat(c.duracion || '—', 'duración') + stat(c.temario.length, 'capítulos') +
        stat(c.ejercicios, 'ejercicios') + stat(c.preguntas, 'preguntas') +
      '</div>' +
      (c.descripcion ? '<p class="desc">' + esc(c.descripcion) + '</p>' : '') +
      (c.requisitos.length ? '<h3>Requisitos</h3><ul class="reqs">' + c.requisitos.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '') +
      '<h3>Temario</h3>' + (temario ? '<ol class="temario">' + temario + '</ol>' : '<div class="empty">Sin capítulos.</div>') +
      '<div class="actions">' +
        '<button id="mDownload"' + (c.estado === 'instalado' ? ' disabled' : '') + '>' + actionLabel(c) + '</button>' +
        (c.web ? '<button class="secondary" id="mWeb">Ver en GitHub</button>' : '') +
        '<button class="secondary" id="mCancel">Cerrar</button>' +
      '</div>';
    if (c.estado !== 'instalado') $('mDownload').addEventListener('click', () => download(c.id));
    if (c.web) $('mWeb').addEventListener('click', () => vscode.postMessage({ type: 'openWeb', id: c.id }));
    $('mCancel').addEventListener('click', closeModal);
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'repoResults') {
      if (msg.error) {
        $('repoOut').innerHTML = '<div class="error">' + esc(msg.error) + '</div>' +
          '<div style="margin-top:8px;display:flex;gap:6px"><button class="small" id="retry">Reintentar</button>' +
          (msg.needsConfig ? '<button class="small secondary" id="openSettings">Abrir ajustes</button>' : '') + '</div>';
        $('retry').addEventListener('click', () => search(true));
        if (msg.needsConfig) $('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
        return;
      }
      renderList(msg);
    } else if (msg.type === 'details') {
      renderDetails(msg.course);
    } else if (msg.type === 'downloaded') {
      if (openId === msg.id) {
        const b = $('mDownload');
        if (b) { b.textContent = msg.estado === 'instalado' ? 'Instalado' : 'Descargar'; b.disabled = msg.estado === 'instalado'; }
      }
      $('repoOut').insertAdjacentHTML('afterbegin', '<div class="status">' + esc(msg.text) + '</div>');
    } else if (msg.type === 'localResults') {
      if (!msg.results.length) { $('localOut').innerHTML = '<div class="empty">Sin resultados.</div>'; return; }
      $('localOut').innerHTML = msg.results.map((r, i) =>
        '<div class="card clickable" data-idx="' + i + '">' +
          '<div class="t">' + esc(r.title) + '</div>' +
          '<div class="s">' + esc(r.snippet) + '</div>' +
          '<div class="tags"><span class="tag">' + esc(r.courseTitle) + '</span><span class="tag">' + esc(r.chapterTitle) + '</span></div>' +
        '</div>'
      ).join('');
      $('localOut').querySelectorAll('.card').forEach(el =>
        el.addEventListener('click', () => vscode.postMessage({ type: 'open', ...msg.results[Number(el.dataset.idx)] }))
      );
    } else if (msg.type === 'status') {
      if (msg.replace && !results.length) $('repoOut').innerHTML = '<div class="status">' + esc(msg.text) + '</div>';
    } else if (msg.type === 'error') {
      if (openId && msg.id === openId) {
        $('mBody').insertAdjacentHTML('afterbegin', '<div class="error">' + esc(msg.text) + '</div>');
        const b = $('mDownload');
        if (b) { b.disabled = false; b.textContent = 'Reintentar descarga'; }
      } else {
        $('repoOut').insertAdjacentHTML('afterbegin', '<div class="error">' + esc(msg.text) + '</div>');
        document.querySelectorAll('button[data-dl]').forEach(b => { if (b.disabled) { b.disabled = false; b.textContent = 'Reintentar'; } });
      }
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
