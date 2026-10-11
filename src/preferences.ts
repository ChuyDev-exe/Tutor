import * as vscode from 'vscode';
import { PROFILES, a11yHead, isProfileActive, registerWebview, resetProfiles, toggleProfile } from './a11y';
import { getActiveConfig, getProviderDef } from './aiClient';
import { getNonce } from './md';

type Control =
  | { key: string; type: 'bool'; label: string; help?: string; def: boolean }
  | { key: string; type: 'range'; label: string; help?: string; def: number; min: number; max: number; step: number; unit?: string }
  | { key: string; type: 'text'; label: string; help?: string; def: string; placeholder?: string };

interface Section {
  id: string;
  title: string;
  intro: string;
  controls: Control[];
}

/** Esquema de la pantalla de preferencias (todas las claves son `tutor.<key>`). */
export const SECTIONS: Section[] = [
  {
    id: 'enfoque',
    title: 'Enfoque',
    intro: 'Menos ruido y un ritmo sostenible: una cosa a la vez.',
    controls: [
      { key: 'focus.modoEnfoque', type: 'bool', label: 'Modo enfoque', help: 'Muestra solo el capítulo actual, oculta lo bloqueado, el progreso global y el buscador, y deja los avisos en la barra de estado.', def: false },
      { key: 'focus.limpiarEditor', type: 'bool', label: 'Entorno despejado durante las sesiones', help: 'Oculta minimapa, migas de pan y «sticky scroll» mientras trabajas. Se restauran al terminar.', def: false },
      { key: 'focus.unaPreguntaALaVez', type: 'bool', label: 'Evaluaciones de una pregunta por pantalla', def: false },
      { key: 'focus.temporizadorAutomatico', type: 'bool', label: 'Iniciar la sesión al abrir un ejercicio', def: false },
      { key: 'focus.mensajes', type: 'bool', label: 'Mensajes de ánimo en la sesión', help: 'Frases breves y tranquilas en el panel de enfoque.', def: true },
      { key: 'focus.minutosTrabajo', type: 'range', label: 'Minutos de trabajo', def: 25, min: 5, max: 90, step: 5, unit: 'min' },
      { key: 'focus.minutosDescanso', type: 'range', label: 'Minutos de descanso', def: 5, min: 1, max: 30, step: 1, unit: 'min' },
      { key: 'focus.metaDiaria', type: 'range', label: 'Meta diaria', help: 'Ejercicios que quieres resolver hoy.', def: 3, min: 1, max: 20, step: 1, unit: 'ejercicios' },
      { key: 'focus.avisoInactividad', type: 'range', label: 'Aviso suave si no hay actividad', help: 'Minutos sin tocar nada antes de recordártelo con delicadeza. 0 lo desactiva.', def: 5, min: 0, max: 30, step: 1, unit: 'min' },
    ],
  },
  {
    id: 'lectura',
    title: 'Lectura y accesibilidad',
    intro: 'Ajusta cómo se ve el texto y qué estímulos hay en pantalla.',
    controls: [
      { key: 'accesibilidad.tamanoTexto', type: 'range', label: 'Tamaño del texto', def: 100, min: 80, max: 200, step: 5, unit: '%' },
      { key: 'accesibilidad.espaciado', type: 'range', label: 'Interlineado', def: 1.5, min: 1.2, max: 2.4, step: 0.1 },
      { key: 'accesibilidad.fuenteLegible', type: 'bool', label: 'Fuente de alta legibilidad', help: 'Más separación entre letras y palabras (útil en dislexia).', def: false },
      { key: 'accesibilidad.anchoLectura', type: 'bool', label: 'Columna de lectura estrecha', def: false },
      { key: 'accesibilidad.altoContraste', type: 'bool', label: 'Alto contraste', help: 'Bordes marcados y enlaces subrayados.', def: false },
      { key: 'accesibilidad.reducirMovimiento', type: 'bool', label: 'Sin animaciones', def: true },
      { key: 'accesibilidad.sinEmojis', type: 'bool', label: 'Sin emojis', help: 'Los quita del árbol y de los avisos.', def: false },
      { key: 'accesibilidad.ocultarRacha', type: 'bool', label: 'Ocultar la racha de días', help: 'Evita la presión de «no romper la racha».', def: false },
    ],
  },
  {
    id: 'aprendizaje',
    title: 'Aprendizaje',
    intro: 'Cómo avanzas y qué se guarda.',
    controls: [
      { key: 'autoCompleteOnPass', type: 'bool', label: 'Resolver el ejercicio al pasar todas las pruebas', def: true },
      { key: 'guardarDudas', type: 'bool', label: 'Guardar mis preguntas al tutor', help: 'Cada pregunta y respuesta va a dudas-y-preguntas.md en tu carpeta del curso.', def: true },
    ],
  },
  {
    id: 'cursos',
    title: 'Cursos',
    intro: 'De dónde salen los cursos.',
    controls: [
      { key: 'repoCatalogUrl', type: 'text', label: 'Catálogo de cursos (URL)', help: 'Dirección http/https de un catalogo.json.', def: '', placeholder: 'https://…/catalogo.json' },
      { key: 'contentPath', type: 'text', label: 'Carpeta extra con cursos locales', def: '', placeholder: 'ruta/a/cursos' },
    ],
  },
];

const allControls = (): Control[] => SECTIONS.flatMap((s) => s.controls);

export class PreferencesPanel {
  private panel?: vscode.WebviewPanel;

  constructor(private context: vscode.ExtensionContext) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      void this.push();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('tutorPreferences', 'Tutor: Preferencias', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    registerWebview(this.panel);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      const c = vscode.workspace.getConfiguration('tutor');
      try {
        if (msg.type === 'ready') await this.push();
        else if (msg.type === 'set') {
          const ctl = allControls().find((x) => x.key === msg.key);
          if (!ctl) return;
          let value: unknown = msg.value;
          if (ctl.type === 'text') value = String(value ?? '').trim() || undefined;
          if (ctl.type === 'range') value = Math.min(ctl.max, Math.max(ctl.min, Number(value)));
          await c.update(ctl.key, value, vscode.ConfigurationTarget.Global);
        } else if (msg.type === 'profile') {
          const p = PROFILES.find((x) => x.label === msg.label);
          if (p) await toggleProfile(p, c);
        } else if (msg.type === 'reset') {
          await resetProfiles(c);
        } else if (msg.type === 'cmd' && ['tutor.configureAI', 'tutor.setApiKey', 'workbench.action.openSettings'].includes(msg.command)) {
          await vscode.commands.executeCommand(msg.command, msg.command === 'workbench.action.openSettings' ? '@ext:' + this.context.extension.id : undefined);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Tutor: no se pudo guardar (${err instanceof Error ? err.message : err}).`);
      }
      await this.push();
    });
  }

  /** Reenvía los valores actuales (tras cambiar un ajuste desde cualquier sitio). */
  async push(): Promise<void> {
    if (!this.panel) return;
    const c = vscode.workspace.getConfiguration('tutor');
    const values: Record<string, unknown> = {};
    for (const ctl of allControls()) values[ctl.key] = c.get(ctl.key, ctl.def);
    const ai = await getActiveConfig(this.context);
    void this.panel.webview.postMessage({
      type: 'state',
      values,
      profiles: PROFILES.map((p) => ({
        label: p.label,
        detail: p.detail,
        active: p.label !== 'Restablecer todo' && isProfileActive(p, c as never),
        reset: p.label === 'Restablecer todo',
      })),
      ai: { provider: getProviderDef(ai.providerId).label, model: ai.model || '—', hasKey: ai.hasKey },
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
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px 28px 60px; max-width: 880px; }
  h1 { font-size: 1.4em; margin: 0 0 4px; }
  .lead { opacity: .75; margin-bottom: 18px; }
  h2 { font-size: 1.05em; margin: 26px 0 2px; }
  .intro { opacity: .7; font-size: .9em; margin-bottom: 8px; }
  .card { border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3)); border-radius: 12px; padding: 4px 16px; background: var(--vscode-editorWidget-background, rgba(127,127,127,.06)); }
  .ctl { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px 0; border-bottom: 1px solid rgba(127,127,127,.18); }
  .ctl:last-child { border-bottom: none; }
  .ctl .txt { flex: 1; min-width: 0; }
  .ctl .lbl { font-weight: 600; }
  .ctl .help { font-size: .85em; opacity: .7; margin-top: 2px; }
  .ctl .val { min-width: 130px; text-align: right; display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
  .ctl .val output { min-width: 4.5em; font-variant-numeric: tabular-nums; opacity: .85; }
  input[type=range] { width: 150px; accent-color: var(--vscode-progressBar-background, #4f8cff); }
  input[type=text] { width: 280px; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, rgba(127,127,127,.4)); border-radius: 6px; }
  .switch { position: relative; width: 42px; height: 24px; flex: none; }
  .switch input { opacity: 0; width: 100%; height: 100%; position: absolute; margin: 0; cursor: pointer; z-index: 1; }
  .switch span { position: absolute; inset: 0; border-radius: 12px; background: rgba(127,127,127,.4); transition: background .15s; }
  .switch span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .switch input:checked + span { background: var(--vscode-progressBar-background, #4f8cff); }
  .switch input:checked + span::after { transform: translateX(18px); }
  .switch input:focus-visible + span { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .profiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .profile { text-align: left; border: 2px solid var(--vscode-panel-border, rgba(127,127,127,.35)); border-radius: 12px; padding: 12px 14px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
  .profile:hover { background: var(--vscode-list-hoverBackground); }
  .profile.on { border-color: var(--vscode-progressBar-background, #4f8cff); background: color-mix(in srgb, var(--vscode-progressBar-background, #4f8cff) 14%, transparent); }
  .profile b { display: block; margin-bottom: 4px; }
  .profile small { opacity: .75; display: block; }
  .profile .st { float: right; font-size: .75em; opacity: .85; }
  .preview { margin-top: 12px; padding: 14px 16px; border-radius: 12px; border: 1px dashed rgba(127,127,127,.5); }
  .preview code { font-family: var(--vscode-editor-font-family, monospace); background: rgba(127,127,127,.2); padding: 1px 5px; border-radius: 4px; }
  button.act { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 7px 14px; cursor: pointer; }
  button.act.secondary { background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3)); color: var(--vscode-button-secondaryForeground, inherit); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 0; align-items: center; }
  .pill { font-size: .8em; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
</style>
${a11yHead(nonce)}
</head>
<body>
  <h1>Preferencias de Tutor</h1>
  <div class="lead">Todo se guarda al instante y se aplica en vivo. Elige un perfil como punto de partida y ajusta lo que quieras.</div>

  <h2>Perfiles rápidos</h2>
  <div class="intro">Combinables. Pulsa un perfil para activarlo o desactivarlo.</div>
  <div class="profiles" id="profiles"></div>

  <div class="preview" id="preview">
    <b>Vista previa del texto</b>
    <p>Así se verá el enunciado de un ejercicio: lee dos números y muestra su suma con <code>printf("%d\\n", a + b);</code>. Cambia el tamaño, el interlineado o la fuente y mira el efecto aquí mismo.</p>
  </div>

  <div id="sections"></div>

  <h2>Tutor con IA</h2>
  <div class="intro">El proveedor y la clave se configuran aparte (la clave se guarda en el almacén seguro del sistema).</div>
  <div class="card">
    <div class="row">
      <span id="aiInfo"></span>
      <button class="act" data-cmd="tutor.configureAI">Configurar IA…</button>
      <button class="act secondary" data-cmd="tutor.setApiKey">Establecer API key…</button>
    </div>
  </div>

  <h2>Otros</h2>
  <div class="row">
    <button class="act secondary" id="reset">Restablecer accesibilidad y enfoque</button>
    <button class="act secondary" data-cmd="workbench.action.openSettings">Abrir todos los ajustes</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SECTIONS = ${JSON.stringify(SECTIONS)};
  let built = false;

  function build() {
    $('sections').innerHTML = SECTIONS.map(s =>
      '<h2>' + esc(s.title) + '</h2><div class="intro">' + esc(s.intro) + '</div><div class="card">' +
      s.controls.map(c => {
        const left = '<div class="txt"><div class="lbl">' + esc(c.label) + '</div>' + (c.help ? '<div class="help">' + esc(c.help) + '</div>' : '') + '</div>';
        let right;
        if (c.type === 'bool') right = '<div class="val"><label class="switch"><input type="checkbox" data-k="' + c.key + '" aria-label="' + esc(c.label) + '"><span></span></label></div>';
        else if (c.type === 'range') right = '<div class="val"><input type="range" data-k="' + c.key + '" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" aria-label="' + esc(c.label) + '"><output data-o="' + c.key + '"></output></div>';
        else right = '<div class="val"><input type="text" data-k="' + c.key + '" placeholder="' + esc(c.placeholder || '') + '" aria-label="' + esc(c.label) + '"></div>';
        return '<div class="ctl">' + left + right + '</div>';
      }).join('') + '</div>').join('');

    document.querySelectorAll('input[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.addEventListener('change', () => vscode.postMessage({ type: 'set', key: k, value: el.checked }));
      else if (el.type === 'range') {
        el.addEventListener('input', () => { const o = document.querySelector('[data-o="' + k + '"]'); if (o) o.textContent = fmt(k, el.value); });
        el.addEventListener('change', () => vscode.postMessage({ type: 'set', key: k, value: Number(el.value) }));
      } else el.addEventListener('change', () => vscode.postMessage({ type: 'set', key: k, value: el.value }));
    });
    document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ type: 'cmd', command: b.dataset.cmd })));
    $('reset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));
    built = true;
  }

  const units = {};
  SECTIONS.forEach(s => s.controls.forEach(c => { if (c.type === 'range') units[c.key] = c.unit || ''; }));
  const fmt = (k, v) => (k === 'focus.avisoInactividad' && Number(v) === 0 ? 'desactivado' : v + (units[k] ? ' ' + units[k] : ''));

  window.addEventListener('message', (e) => {
    if (e.data.type !== 'state') return;
    if (!built) build();
    const { values, profiles, ai } = e.data;
    document.querySelectorAll('input[data-k]').forEach(el => {
      const v = values[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'range') { el.value = v; const o = document.querySelector('[data-o="' + el.dataset.k + '"]'); if (o) o.textContent = fmt(el.dataset.k, v); }
      else if (document.activeElement !== el) el.value = v || '';
    });
    $('profiles').innerHTML = profiles.filter(p => !p.reset).map(p =>
      '<button class="profile' + (p.active ? ' on' : '') + '" data-p="' + esc(p.label) + '" aria-pressed="' + p.active + '"><span class="st">' + (p.active ? '✓ activo' : 'desactivado') + '</span><b>' + esc(p.label) + '</b><small>' + esc(p.detail) + '</small></button>').join('');
    document.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ type: 'profile', label: b.dataset.p })));
    $('aiInfo').innerHTML = '<span class="pill">' + esc(ai.provider) + '</span> <span class="pill">' + esc(ai.model) + '</span> <span class="pill">' + (ai.hasKey ? 'clave guardada' : 'sin clave') + '</span>';
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
