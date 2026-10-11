import * as vscode from 'vscode';
import { a11yHead, registerWebview } from './a11y';
import { FocusSnapshot, FocusTimer } from './focus';
import { getNonce } from './md';

export interface StepInfo {
  label: string;
  done: number;
  total: number;
}

/** Vista lateral «Sesión de enfoque»: anillo de tiempo, tarea actual, meta del día y mensajes de apoyo. */
export class FocusViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tutorFocus';
  private view?: vscode.WebviewView;

  constructor(private timer: FocusTimer, private getStep: () => StepInfo | undefined) {
    timer.onDidChange(() => this.push());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    registerWebview(view);
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          this.push();
          break;
        case 'toggle':
          this.timer.toggle();
          this.push();
          break;
        case 'stop':
          this.timer.stop();
          this.push();
          break;
        case 'skip':
          this.timer.skipBreak();
          break;
        case 'step':
          void vscode.commands.executeCommand('tutor.nextStep');
          break;
        case 'park':
          void vscode.commands.executeCommand('tutor.parkThought');
          break;
        case 'prefs':
          void vscode.commands.executeCommand('tutor.preferences');
          break;
      }
    });
    view.onDidChangeVisibility(() => view.visible && this.push());
  }

  /** Refresca la tarea actual (p. ej. al avanzar el progreso). */
  refresh(): void {
    this.push();
  }

  private push(): void {
    if (!this.view?.visible) return;
    const snap: FocusSnapshot = this.timer.snapshot();
    void this.view.webview.postMessage({
      type: 'snap',
      snap,
      step: this.getStep() ?? null,
      mensajes: vscode.workspace.getConfiguration('tutor').get<boolean>('focus.mensajes', true),
    });
  }

  private html(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { --accent: var(--vscode-progressBar-background, #4f8cff); --rest: #3fb68b; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; margin: 0; }
  .card { border-radius: 10px; padding: 8px 10px; background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%), var(--vscode-editorWidget-background, rgba(127,127,127,.1)); border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3)); }
  body.rest .card { background: linear-gradient(160deg, color-mix(in srgb, var(--rest) 20%, transparent), transparent 70%), var(--vscode-editorWidget-background, rgba(127,127,127,.1)); }
  .phase { text-align: center; font-size: .8em; letter-spacing: .12em; text-transform: uppercase; opacity: .75; }
  .ring { position: relative; width: 112px; height: 112px; margin: 4px auto; }
  .ring svg { transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 7; }
  .ring .bg { stroke: rgba(127,127,127,.25); }
  .ring .fg { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
  body.rest .ring .fg { stroke: var(--rest); }
  .time { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .time b { font-size: 1.7em; font-variant-numeric: tabular-nums; font-weight: 600; }
  .time span { font-size: .78em; opacity: .7; }
  .msg { text-align: center; font-size: .92em; margin: 2px 4px 6px; min-height: 0; opacity: .85; font-size: .85em; }
  .row { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 3px 12px; cursor: pointer; font-size: .9em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3)); color: var(--vscode-button-secondaryForeground, inherit); }
  button.link { background: none; color: var(--vscode-textLink-foreground); padding: 2px 6px; font-size: .85em; }
  h3 { font-size: .8em; text-transform: uppercase; letter-spacing: .08em; opacity: .7; margin: 10px 2px 4px; font-weight: 600; }
  .task { padding: 6px 8px; border-radius: 8px; border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3)); display: flex; flex-direction: column; gap: 5px; }
  .task .t { font-weight: 600; }
  .bar { height: 4px; border-radius: 2px; background: rgba(127,127,127,.25); overflow: hidden; }
  .bar > div { height: 100%; background: var(--accent); }
  .dots { display: flex; gap: 4px; flex-wrap: wrap; margin: 2px 0 4px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--accent); box-sizing: border-box; }
  .dot.on { background: var(--accent); }
  .stats { display: flex; gap: 8px; }
  .stat { flex: 1; text-align: center; padding: 4px 2px; border-radius: 8px; background: rgba(127,127,127,.12); }
  .stat b { display: block; font-size: 1.05em; }
  .stat span { font-size: .68em; opacity: .75; }
  .rest-tips { display: none; margin-top: 8px; font-size: .88em; }
  body.rest .rest-tips { display: block; }
  .foot { display: flex; justify-content: space-between; margin-top: 10px; }
  .hidden { display: none !important; }
</style>
${a11yHead(nonce)}
</head>
<body>
  <div class="card">
    <div class="phase" id="phase">Listo para empezar</div>
    <div class="ring">
      <svg width="112" height="112" viewBox="0 0 168 168" aria-hidden="true">
        <circle class="bg" cx="84" cy="84" r="74"/>
        <circle class="fg" id="fg" cx="84" cy="84" r="74" stroke-dasharray="464.96" stroke-dashoffset="0"/>
      </svg>
      <div class="time"><b id="clock" role="timer" aria-live="off">25:00</b><span id="sub">minutos</span></div>
    </div>
    <div class="msg" id="msg"></div>
    <div class="row">
      <button id="toggle">Iniciar</button>
      <button id="skip" class="secondary hidden">Saltar descanso</button>
      <button id="stop" class="secondary hidden">Terminar</button>
    </div>
    <div class="rest-tips">
      <b>Mientras descansas:</b>
      <ul style="margin:4px 0 0 18px;padding:0">
        <li>Mira algo lejano durante 20 segundos.</li>
        <li>Bebe agua y estira cuello y hombros.</li>
        <li>Respira hondo tres veces.</li>
      </ul>
    </div>
  </div>

  <h3>Ahora toca</h3>
  <div class="task">
    <div class="t" id="taskLabel">—</div>
    <div class="bar"><div id="taskBar" style="width:0"></div></div>
    <div class="row" style="justify-content:flex-start"><button id="go">Ir al siguiente paso</button></div>
  </div>

  <h3>Meta de hoy</h3>
  <div id="goalText" style="font-size:.9em"></div>
  <div class="dots" id="dots"></div>
  <div class="stats">
    <div class="stat"><b id="sMin">0</b><span>min de enfoque</span></div>
    <div class="stat"><b id="sSes">0</b><span>sesiones</span></div>
    <div class="stat"><b id="sSolved">0</b><span>resueltos hoy</span></div>
  </div>

  <div class="foot">
    <button class="link" id="park" title="Apunta lo que te distrajo y sigue">Anotar un pensamiento</button>
    <button class="link" id="prefs">Preferencias</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const C = 2 * Math.PI * 74;
  const fmt = (ms) => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

  $('toggle').onclick = () => vscode.postMessage({ type: 'toggle' });
  $('stop').onclick = () => vscode.postMessage({ type: 'stop' });
  $('skip').onclick = () => vscode.postMessage({ type: 'skip' });
  $('go').onclick = () => vscode.postMessage({ type: 'step' });
  $('park').onclick = () => vscode.postMessage({ type: 'park' });
  $('prefs').onclick = () => vscode.postMessage({ type: 'prefs' });

  function say(s, goalDone) {
    if (!s.active) return goalDone ? 'Meta cumplida. Lo que hagas ahora es un extra.' : 'Cuando quieras, empieza con un solo paso pequeño.';
    if (s.phase === 'descanso') return 'Descansa de verdad. Volverás con la mente más fresca.';
    if (s.paused) return 'En pausa. Retomamos cuando estés listo.';
    const used = 1 - s.remainingMs / s.totalMs;
    if (used < 0.15) return 'Empieza por lo más pequeño. Un paso y ya.';
    if (used < 0.5) return 'Vas bien. Mantén la atención en una sola cosa.';
    if (used < 0.85) return 'Más de la mitad. Sigue, ya casi.';
    return 'Último tramo. Cierra con calma.';
  }

  window.addEventListener('message', (e) => {
    if (e.data.type !== 'snap') return;
    const { snap: s, step, mensajes } = e.data;
    document.body.classList.toggle('rest', s.phase === 'descanso' && s.active);
    $('phase').textContent = !s.active ? 'Listo para empezar' : s.phase === 'trabajo' ? (s.paused ? 'Enfoque · en pausa' : 'Enfoque') : 'Descanso';
    $('clock').textContent = fmt(s.remainingMs);
    $('sub').textContent = s.active ? (s.phase === 'trabajo' ? 'queda de esta sesión' : 'de descanso') : 'minutos';
    const frac = s.active && s.totalMs ? s.remainingMs / s.totalMs : 1;
    $('fg').setAttribute('stroke-dashoffset', String(C * (1 - frac)));
    $('toggle').textContent = !s.active ? 'Iniciar sesión' : s.paused ? 'Reanudar' : 'Pausar';
    $('stop').classList.toggle('hidden', !s.active);
    $('skip').classList.toggle('hidden', !(s.active && s.phase === 'descanso'));
    const goalDone = s.solvedToday >= s.goal;
    $('msg').textContent = mensajes ? say(s, goalDone) : '';

    $('taskLabel').textContent = step ? step.label : 'Todo al día. ¡Buen trabajo!';
    $('taskBar').style.width = step && step.total ? (step.done / step.total * 100) + '%' : '100%';
    $('go').classList.toggle('hidden', !step);

    $('goalText').textContent = goalDone
      ? '¡Meta cumplida! ' + s.solvedToday + ' ejercicio(s) resueltos hoy.'
      : s.solvedToday + ' de ' + s.goal + ' ejercicio(s) resueltos hoy';
    $('dots').innerHTML = Array.from({ length: s.goal }, (_, i) => '<span class="dot' + (i < s.solvedToday ? ' on' : '') + '"></span>').join('');
    $('sMin').textContent = s.minutesToday;
    $('sSes').textContent = s.sessionsToday;
    $('sSolved').textContent = s.solvedToday;
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
