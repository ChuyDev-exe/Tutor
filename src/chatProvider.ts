import * as vscode from 'vscode';
import { a11yHead, registerWebview } from './a11y';
import { ChatMessage, getActiveConfig, getProviderDef, chat } from './aiClient';
import { buildTutorSystemPrompt } from './prompt';
import { getNonce, renderMarkdown } from './md';
import { readText } from './content';
import { recentQuestions, saveDoubt } from './doubts';
import { Course, TutorContext } from './types';

const CHAT_KEY = 'tutor.chat.v1';
const MAX_HISTORY = 40;

/**
 * Chat del tutor en el sidebar. La extensión inyecta SIEMPRE el system prompt
 * de mentor (el usuario no puede desactivarlo): la IA orienta, no entrega soluciones.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tutorChat';
  private view?: vscode.WebviewView;
  private history: ChatMessage[] = [];
  private busy = false;

  constructor(
    private context: vscode.ExtensionContext,
    private getCourses: () => Course[],
    private getTutorContext: () => TutorContext
  ) {
    this.history = context.workspaceState.get<ChatMessage[]>(CHAT_KEY, []);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    registerWebview(view);
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'send':
          await this.onSend(String(msg.text || '').trim());
          break;
        case 'clear':
          if (this.busy) break;
          this.history = [];
          await this.context.workspaceState.update(CHAT_KEY, this.history);
          view.webview.postMessage({ type: 'clear' });
          break;
        case 'openDoubts':
          vscode.commands.executeCommand('tutor.openDoubts');
          break;
        case 'configure':
          vscode.commands.executeCommand('tutor.configureAI');
          break;
      }
    });

    void this.pushInitialState();
  }

  /** Llamar tras configurar la IA para actualizar el estado del chat. */
  async refreshConfig(): Promise<void> {
    await this.pushInitialState();
  }

  private async pushInitialState(): Promise<void> {
    const cfg = await getActiveConfig(this.context);
    const def = getProviderDef(cfg.providerId);
    const ctx = this.getTutorContext();
    this.view?.webview.postMessage({
      type: 'init',
      providerLabel: def.label,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      hasKey: cfg.hasKey,
      history: this.history.map((m) => ({
        role: m.role,
        html: renderMarkdown(m.content),
      })),
      contextLabel: this.contextLabel(ctx),
    });
  }

  private contextLabel(ctx: TutorContext): string {
    if (!ctx.courseId) return 'Sin selección';
    const course = this.getCourses().find((c) => c.id === ctx.courseId);
    if (!course) return 'Sin selección';
    let label = course.titulo;
    const chapter = course.capitulos.find((c) => c.id === ctx.chapterId);
    if (chapter) label += ' → ' + chapter.titulo;
    const exercise = chapter?.ejercicios.find((e) => e.id === ctx.exerciseId);
    if (exercise) label += ' → ' + exercise.titulo;
    return label;
  }

  private buildSystemPrompt(): string {
    const courses = this.getCourses();
    const ctx = this.getTutorContext();
    const course = courses.find((c) => c.id === ctx.courseId);
    const chapter = course?.capitulos.find((c) => c.id === ctx.chapterId);
    const exercise = chapter?.ejercicios.find((e) => e.id === ctx.exerciseId);
    return buildTutorSystemPrompt({
      language: vscode.workspace.getConfiguration('tutor').get<string>('language') || 'español',
      courseTitle: course?.titulo,
      chapterTitles: course?.capitulos.map((c) => c.titulo) || [],
      currentChapterTitle: chapter?.titulo,
      currentChapterContent: chapter ? readText(chapter.archivo) : undefined,
      previousQuestions: recentQuestions(course),
      studentCode: ctx.studentFile ? readText(ctx.studentFile) : undefined,
      lastOutput: ctx.lastOutput,
      currentExercise: exercise
        ? { titulo: exercise.titulo, enunciado: readText(exercise.enunciadoFile) }
        : undefined,
    });
  }

  /** Ventana de historial que siempre empieza con un mensaje de usuario (requisito de Anthropic/Gemini). */
  private trimmedHistory(): ChatMessage[] {
    const h = this.history.slice(-MAX_HISTORY);
    const first = h.findIndex((m) => m.role === 'user');
    return first <= 0 ? h : h.slice(first);
  }

  /** Guarda la pregunta y su respuesta en el archivo de dudas del alumno. */
  private saveToDoubts(question: string, answer: string): void {
    if (!vscode.workspace.getConfiguration('tutor').get<boolean>('guardarDudas', true)) return;
    try {
      const ctx = this.getTutorContext();
      const course = this.getCourses().find((c) => c.id === ctx.courseId);
      const chapter = course?.capitulos.find((c) => c.id === ctx.chapterId);
      const exercise = chapter?.ejercicios.find((e) => e.id === ctx.exerciseId);
      if (saveDoubt(course, chapter, exercise, question, answer)) {
        this.view?.webview.postMessage({ type: 'saved' });
      }
    } catch {
      /* guardar dudas es un extra: nunca debe romper el chat */
    }
  }

  private async onSend(text: string): Promise<void> {
    if (!text || this.busy) return;
    this.busy = true;
    try {
      this.history.push({ role: 'user', content: text });
      this.view?.webview.postMessage({ type: 'user', text });
      this.view?.webview.postMessage({ type: 'thinking', on: true });

      const systemPrompt = this.buildSystemPrompt();
      // el markdown se renderiza a lo sumo cada 80 ms mientras llega la respuesta
      let lastPaint = 0;
      const reply = await chat(this.context, systemPrompt, this.trimmedHistory(), (soFar) => {
        const now = Date.now();
        if (now - lastPaint < 80) return;
        lastPaint = now;
        this.view?.webview.postMessage({ type: 'partial', html: renderMarkdown(soFar) });
      });

      this.history.push({ role: 'assistant', content: reply });
      if (this.history.length > MAX_HISTORY) {
        this.history = this.trimmedHistory();
      }
      await this.context.workspaceState.update(CHAT_KEY, this.history);
      this.view?.webview.postMessage({ type: 'thinking', on: false });
      this.view?.webview.postMessage({ type: 'assistant', html: renderMarkdown(reply) });
      this.saveToDoubts(text, reply);
    } catch (err) {
      this.history.pop(); // quita el mensaje de usuario para no dejarlo huérfano
      const text = err instanceof Error ? err.message : String(err);
      this.view?.webview.postMessage({ type: 'thinking', on: false });
      this.view?.webview.postMessage({
        type: 'error',
        text: `${text}\n\nUsa "Tutor: Configurar IA del tutor" para revisar proveedor, modelo y API key.`,
      });
    } finally {
      this.busy = false;
    }
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
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; margin: 0; }
  #status { padding: 3px 8px; font-size: .78em; opacity: .75; display: flex; justify-content: space-between; gap: 6px; align-items: center; }
  #status .model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #messages { flex: 1; overflow-y: auto; padding: 4px 8px; display: flex; flex-direction: column; gap: 8px; }
  .msg { line-height: 1.45; max-width: 100%; word-wrap: break-word; }
  .msg.user { background: var(--vscode-input-background); align-self: flex-end; max-width: 88%; white-space: pre-wrap; padding: 4px 9px; border-radius: 10px 10px 2px 10px; }
  .msg.assistant { align-self: flex-start; padding: 0 2px; }
  .msg.error { background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,.12)); color: var(--vscode-errorForeground); font-size: .88em; padding: 4px 8px; border-radius: 6px; }
  .msg p { margin: 0 0 5px; } .msg p:last-child { margin: 0; }
  pre.code { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); padding: 6px 8px; border-radius: 5px; overflow: auto; font-size: .92em; margin: 4px 0; }
  code { font-family: var(--vscode-editor-font-family, monospace); background: rgba(127,127,127,.18); padding: 0 3px; border-radius: 3px; }
  pre.code code { background: none; padding: 0; }
  .note { font-size: .75em; opacity: .6; align-self: flex-start; margin-top: -5px; }
  #thinking { padding: 0 10px 2px; font-size: .75em; opacity: .6; display: none; }
  #thinking::after { content: ''; animation: dots 1.2s steps(4) infinite; }
  @keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
  #inputRow { display: flex; align-items: flex-end; gap: 4px; margin: 4px 8px 8px; padding: 2px 2px 2px 8px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, rgba(127,127,127,.3)); border-radius: 8px; }
  #inputRow:focus-within { border-color: var(--vscode-focusBorder); }
  textarea { flex: 1; resize: none; background: none; color: var(--vscode-input-foreground); border: none; outline: none; padding: 4px 0; font-family: inherit; font-size: inherit; line-height: 1.35; height: 24px; max-height: 120px; }
  button { background: none; color: var(--vscode-foreground); border: none; border-radius: 4px; cursor: pointer; font-family: inherit; }
  #sendBtn { color: var(--vscode-button-foreground); background: var(--vscode-button-background); width: 24px; height: 24px; padding: 0; border-radius: 6px; flex: none; }
  #sendBtn:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .4; cursor: default; }
  button.link { color: var(--vscode-textLink-foreground); padding: 0 2px; font-size: inherit; }
  button.link:hover { text-decoration: underline; }
  #chips { display: flex; gap: 4px; padding: 0 8px 2px; overflow-x: auto; scrollbar-width: none; }
  #chips::-webkit-scrollbar { display: none; }
  button.chip { flex: none; border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35)); padding: 0 8px; border-radius: 10px; font-size: .75em; line-height: 18px; opacity: .85; }
  button.chip:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
  ul { margin: 3px 0; padding-left: 16px; }
</style>
${a11yHead(nonce)}
</head>
<body>
  <div id="status">
    <span class="model" id="modelLabel">Sin configurar</span>
    <span><button class="link" id="clearBtn" title="Borrar la conversación">Limpiar</button> · <button class="link" id="cfgBtn">Ajustes</button></span>
  </div>
  <div id="messages"></div>
  <div id="thinking">Pensando</div>
  <div id="chips">
    <button class="chip" data-q="Dame una pista para empezar, sin darme la solución.">Pista</button>
    <button class="chip" data-q="Mi última ejecución dio un error o falló pruebas. ¿Qué crees que significa? Guíame sin corregirlo por mí.">Mi error</button>
    <button class="chip" data-q="Revisa mi código actual y dime en qué zona debería fijarme, sin reescribirlo.">Revisar código</button>
    <button class="chip" data-q="Explícame con una analogía el concepto principal de este capítulo.">Explicar tema</button>
    <button class="chip" id="doubtsBtn" title="Abrir tu archivo de dudas y preguntas">Mis dudas</button>
  </div>
  <div id="inputRow">
    <textarea id="input" rows="1" placeholder="Pregunta al tutor…"></textarea>
    <button id="sendBtn" title="Enviar (Enter)">➤</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const messages = $('messages');
  let live = null; // respuesta que está llegando en streaming
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function add(role, html) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.innerHTML = html;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function send() {
    const text = $('input').value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text });
    $('input').value = '';
    grow();
  }
  const grow = () => { const t = $('input'); t.style.height = '24px'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; };
  $('input').addEventListener('input', grow);
  $('sendBtn').addEventListener('click', send);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  document.querySelectorAll('.chip[data-q]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ type: 'send', text: b.dataset.q })));
  $('doubtsBtn').addEventListener('click', () => vscode.postMessage({ type: 'openDoubts' }));
  $('cfgBtn').addEventListener('click', () => vscode.postMessage({ type: 'configure' }));
  $('clearBtn').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'init') {
      $('modelLabel').textContent =
        msg.providerLabel + ' · ' + (msg.model || 'modelo?') + (msg.hasKey ? '' : ' · falta API key');
      $('modelLabel').title = (msg.baseUrl || '') + (msg.contextLabel ? ' · Viendo: ' + msg.contextLabel : '');
      if (msg.contextLabel) $('modelLabel').textContent = msg.contextLabel + ' · ' + $('modelLabel').textContent;
      messages.innerHTML = '';
      if (!msg.history.length) {
        add('assistant', '<p>Hola, soy tu tutor. Te oriento con preguntas y pistas; el código lo escribes tú.</p>');
      } else {
        msg.history.forEach((m) => add(m.role, m.html));
      }
    } else if (msg.type === 'user') {
      add('user', esc(msg.text));
    } else if (msg.type === 'partial') {
      $('thinking').style.display = 'none';
      if (!live) { add('assistant', ''); live = messages.lastElementChild; live.setAttribute('aria-busy', 'true'); }
      const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
      live.innerHTML = msg.html;
      if (atBottom) messages.scrollTop = messages.scrollHeight;
    } else if (msg.type === 'assistant') {
      if (live) { live.innerHTML = msg.html; live.removeAttribute('aria-busy'); live = null; messages.scrollTop = messages.scrollHeight; }
      else add('assistant', msg.html);
    } else if (msg.type === 'saved') {
      const n = document.createElement('div');
      n.className = 'note';
      n.innerHTML = 'Guardada en tus dudas · <button class="link" id="openSaved">abrir</button>';
      messages.appendChild(n);
      n.querySelector('button').addEventListener('click', () => vscode.postMessage({ type: 'openDoubts' }));
      messages.scrollTop = messages.scrollHeight;
    } else if (msg.type === 'thinking') {
      $('thinking').style.display = msg.on ? 'block' : 'none';
      $('sendBtn').disabled = msg.on;
      messages.scrollTop = messages.scrollHeight;
    } else if (msg.type === 'error') {
      if (live) { live.remove(); live = null; }
      add('error', esc(msg.text).replace(/\\n/g, '<br>'));
    } else if (msg.type === 'clear') {
      messages.innerHTML = '';
      add('assistant', '<p>Conversación reiniciada. ¿En qué te ayudo?</p>');
    }
  });
</script>
</body>
</html>`;
  }
}
