import * as vscode from 'vscode';
import { a11yHead, registerWebview } from './a11y';
import { getNonce } from './md';
import { searchLocal } from './content';
import { fetchCatalog, downloadCourse, getCatalogUrl } from './repo';
import { RepoCourseEntry } from './types';
import { compareVersions } from './pure';

/**
 * Vista lateral con dos pestañas:
 *  - "Repositorio": busca cursos en el catálogo remoto y los descarga al workspace.
 *  - "Clases": búsqueda full-text en los cursos instalados.
 */
export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tutorSearch';
  private view?: vscode.WebviewView;

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
          case 'searchRepo':
            await this.searchRepo(msg.query);
            break;
          case 'download':
            await this.download(msg.entry);
            break;
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
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'tutor.repoCatalogUrl'
            );
            break;
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        view.webview.postMessage({ type: 'error', text });
      }
    });
  }

  private async searchRepo(query: string): Promise<void> {
    const catalogUrl = getCatalogUrl();
    if (!catalogUrl) {
      this.view?.webview.postMessage({
        type: 'repoResults',
        error:
          'Configura tutor.repoCatalogUrl con la URL del catalogo.json del repositorio de cursos.',
        needsConfig: true,
        results: [],
      });
      return;
    }
    this.view?.webview.postMessage({ type: 'status', text: 'Leyendo catálogo…' });
    const catalog = await fetchCatalog();
    const q = query.toLowerCase().trim();
    const results = catalog.cursos.filter(
      (c) =>
        !q ||
        c.titulo.toLowerCase().includes(q) ||
        (c.descripcion || '').toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (c.nivel || '').toLowerCase().includes(q)
    );
    const installed = new Map(this.getChaptersProvider().allCourses.map((c) => [c.id, c.version]));
    const withState = results.map((c) => {
      let estado: 'nuevo' | 'instalado' | 'actualizar' = 'nuevo';
      if (installed.has(c.id)) {
        const have = installed.get(c.id);
        estado = c.version && (!have || compareVersions(c.version, have) > 0) ? 'actualizar' : 'instalado';
      }
      return { ...c, estado };
    });
    this.view?.webview.postMessage({
      type: 'repoResults',
      repoName: catalog.nombre || catalogUrl,
      results: withState,
    });
  }

  private async download(entry: RepoCourseEntry): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error('Abre una carpeta de trabajo (workspace) para descargar el curso.');
    }
    const isUpdate = this.getChaptersProvider().allCourses.some((c) => c.id === entry.id);
    const dir = await downloadCourse(entry);
    this.getChaptersProvider().reload();
    void vscode.commands.executeCommand('tutor.courseInstalled', entry.id, isUpdate);
    this.view?.webview.postMessage({
      type: 'downloaded',
      text: `Curso "${entry.titulo}" ${isUpdate ? 'actualizado' : 'descargado'}.`,
    });
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
  .card { padding: 5px 4px; border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.2)); }
  .card.clickable { cursor: pointer; }
  .card.clickable:hover { background: var(--vscode-list-hoverBackground); }
  .t { font-weight: 600; }
  .d, .s { opacity: .75; font-size: .85em; margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tags { margin-top: 3px; display: flex; gap: 3px; flex-wrap: wrap; }
  .tag { font-size: .7em; opacity: .75; border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.4)); padding: 0 5px; border-radius: 8px; }
  .card-head { display: flex; justify-content: space-between; gap: 6px; align-items: flex-start; }
  .status { margin: 6px 0 2px; opacity: .65; font-size: .8em; }
  .error { margin-top: 6px; color: var(--vscode-errorForeground); font-size: .9em; }
  .empty { opacity: .55; margin-top: 8px; font-size: .85em; }
  a { color: var(--vscode-textLink-foreground); }
</style>
${a11yHead(nonce)}
</head>
<body>
  <div class="tabs">
    <div class="tab active" id="tabRepo">Repositorio</div>
    <div class="tab" id="tabLocal">Clases</div>
  </div>

  <div id="panelRepo">
    <div class="row">
      <input id="repoQ" type="text" placeholder="Buscar cursos…" />
      <button id="repoGo">Buscar</button>
    </div>
    <div id="repoOut"><div class="empty">Busca cursos y descárgalos.</div></div>
  </div>

  <div id="panelLocal" style="display:none">
    <div class="row">
      <input id="localQ" type="text" placeholder="Buscar clases y ejercicios…" />
      <button id="localGo">Buscar</button>
    </div>
    <div id="localOut"><div class="empty">Busca en tus cursos instalados.</div></div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function showTab(which) {
    $('tabRepo').classList.toggle('active', which === 'repo');
    $('tabLocal').classList.toggle('active', which === 'local');
    $('panelRepo').style.display = which === 'repo' ? '' : 'none';
    $('panelLocal').style.display = which === 'local' ? '' : 'none';
  }
  $('tabRepo').addEventListener('click', () => showTab('repo'));
  $('tabLocal').addEventListener('click', () => showTab('local'));

  $('repoGo').addEventListener('click', () => {
    $('repoOut').innerHTML = '<div class="status">Buscando…</div>';
    vscode.postMessage({ type: 'searchRepo', query: $('repoQ').value });
  });
  $('repoQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('repoGo').click(); });

  $('localGo').addEventListener('click', () => {
    const q = $('localQ').value.trim();
    if (q) vscode.postMessage({ type: 'searchLocal', query: q });
  });
  $('localQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('localGo').click(); });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'repoResults') {
      if (msg.error) {
        $('repoOut').innerHTML = '<div class="error">' + esc(msg.error) + '</div>' +
          (msg.needsConfig ? '<div style="margin-top:8px"><button class="small" id="openSettings">Abrir ajustes</button></div>' : '');
        if (msg.needsConfig) $('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
        return;
      }
      const header = '<div class="status">' + esc(msg.repoName) + ' · ' + msg.results.length + ' curso(s)</div>';
      if (!msg.results.length) { $('repoOut').innerHTML = header + '<div class="empty">Sin resultados.</div>'; return; }
      $('repoOut').innerHTML = header + msg.results.map((c, i) =>
        '<div class="card"><div class="card-head"><div>' +
          '<div class="t">' + esc(c.titulo) + '</div>' +
          '<div class="d">' + esc(c.descripcion || '') + '</div>' +
          '<div class="tags">' + [esc(c.nivel || '')].concat((c.tags || []).map(esc)).filter(Boolean).map(t => '<span class="tag">' + t + '</span>').join('') + '</div>' +
        '</div>' + (c.estado === 'instalado'
          ? '<button class="small" disabled>Instalado</button>'
          : '<button class="small" data-idx="' + i + '">' + (c.estado === 'actualizar' ? 'Actualizar' + (c.version ? ' a v' + esc(c.version) : '') : 'Descargar') + '</button>') + '</div></div>'
      ).join('');
      $('repoOut').querySelectorAll('button[data-idx]').forEach(btn =>
        btn.addEventListener('click', () => {
          btn.textContent = 'Descargando…'; btn.disabled = true;
          vscode.postMessage({ type: 'download', entry: msg.results[Number(btn.dataset.idx)] });
        })
      );
    } else if (msg.type === 'downloaded') {
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
      $('repoOut').insertAdjacentHTML('afterbegin', '<div class="status">' + esc(msg.text) + '</div>');
    } else if (msg.type === 'error') {
      $('repoOut').insertAdjacentHTML('afterbegin', '<div class="error">' + esc(msg.text) + '</div>');
    }
  });
</script>
</body>
</html>`;
  }
}
