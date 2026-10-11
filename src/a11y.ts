import * as vscode from 'vscode';

/**
 * Accesibilidad y enfoque. Todo se controla con ajustes `tutor.focus.*` y
 * `tutor.accesibilidad.*`; los webviews reciben el CSS en caliente al cambiarlos.
 */
const cfg = () => vscode.workspace.getConfiguration('tutor');

export const focusMode = (): boolean => cfg().get<boolean>('focus.modoEnfoque', false);
export const oneQuestionAtATime = (): boolean => cfg().get<boolean>('focus.unaPreguntaALaVez', false);
export const noEmojis = (): boolean => cfg().get<boolean>('accesibilidad.sinEmojis', false);
export const hideStreak = (): boolean => cfg().get<boolean>('accesibilidad.ocultarRacha', false);

const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;
export const stripEmoji = (s: string): string => s.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();

/** Texto de interfaz: sin emojis si el usuario lo pidió. */
export const ui = (s: string): string => (noEmojis() ? stripEmoji(s) : s);

/**
 * Aviso informativo. En modo enfoque, los avisos sin acciones no interrumpen:
 * van a la barra de estado y desaparecen solos.
 */
export function notify(message: string, ...rest: any[]): Thenable<string | undefined> {
  const text = ui(message);
  const hasActions = rest.some((r) => typeof r === 'string') || (rest[0] && typeof rest[0] === 'object');
  if (focusMode() && !hasActions) {
    vscode.window.setStatusBarMessage(text, 6000);
    return Promise.resolve(undefined);
  }
  return (vscode.window.showInformationMessage as any)(text, ...rest);
}

export function a11yCss(): string {
  const size = Math.min(200, Math.max(80, cfg().get<number>('accesibilidad.tamanoTexto', 100)));
  const spacing = Math.min(2.4, Math.max(1.2, cfg().get<number>('accesibilidad.espaciado', 1.5)));
  let css = `body { font-size: calc(var(--vscode-font-size, 13px) * ${size / 100}) !important; line-height: ${spacing} !important; }\n`;
  if (cfg().get<boolean>('accesibilidad.fuenteLegible', false)) {
    css += `body, button, input, textarea { font-family: "Atkinson Hyperlegible", Verdana, Tahoma, Arial, sans-serif !important; letter-spacing: .03em; word-spacing: .1em; }\n`;
  }
  if (cfg().get<boolean>('accesibilidad.anchoLectura', false)) {
    css += `body { max-width: 70ch; }\n`;
  }
  if (cfg().get<boolean>('accesibilidad.altoContraste', false)) {
    css += `.q, .case, .card, .section, .msg, .tab, input, textarea { border: 2px solid var(--vscode-contrastBorder, currentColor) !important; }
button { outline: 1px solid var(--vscode-contrastBorder, currentColor); }
a { text-decoration: underline; }\n`;
  }
  const still = `* { animation: none !important; transition: none !important; scroll-behavior: auto !important; }\n`;
  css += cfg().get<boolean>('accesibilidad.reducirMovimiento', true) ? still : `@media (prefers-reduced-motion: reduce) { ${still} }\n`;
  return css;
}

/** Bloque para el <head> de cada webview: CSS de accesibilidad + escucha de cambios en vivo. */
export function a11yHead(nonce: string): string {
  return `<style id="a11y">${a11yCss()}</style>
<script nonce="${nonce}">window.addEventListener('message',function(e){if(e.data&&e.data.type==='a11y'){var s=document.getElementById('a11y');if(s)s.textContent=e.data.css;}});</script>`;
}

const webviews = new Set<vscode.Webview>();

/** Registra un webview para recibir actualizaciones de accesibilidad. */
export function registerWebview(panel: { webview: vscode.Webview; onDidDispose: vscode.Event<void> }): void {
  webviews.add(panel.webview);
  panel.onDidDispose(() => webviews.delete(panel.webview));
}

export function broadcastA11y(): void {
  const css = a11yCss();
  for (const w of webviews) void w.postMessage({ type: 'a11y', css });
}

const RESET_LABEL = 'Restablecer todo';

/** Perfiles que ajustan varios ajustes de una vez. */
export const PROFILES: { label: string; detail: string; values: Record<string, unknown> }[] = [
  {
    label: 'Enfoque (TDAH)',
    detail: 'Un paso a la vez, avisos silenciosos, una pregunta por pantalla, temporizador de pausas y sin racha.',
    values: {
      'focus.modoEnfoque': true,
      'focus.unaPreguntaALaVez': true,
      'focus.temporizadorAutomatico': true,
      'accesibilidad.ocultarRacha': true,
      'accesibilidad.reducirMovimiento': true,
      'accesibilidad.anchoLectura': true,
    },
  },
  {
    label: 'Calma y claridad (autismo)',
    detail: 'Sin emojis, sin movimiento, estructura constante, avisos silenciosos y texto literal.',
    values: {
      'focus.modoEnfoque': true,
      'accesibilidad.sinEmojis': true,
      'accesibilidad.reducirMovimiento': true,
      'accesibilidad.ocultarRacha': true,
      'accesibilidad.anchoLectura': true,
    },
  },
  {
    label: 'Lectura cómoda (dislexia)',
    detail: 'Fuente legible, más espaciado, texto algo mayor y columna de lectura estrecha.',
    values: {
      'accesibilidad.fuenteLegible': true,
      'accesibilidad.espaciado': 1.9,
      'accesibilidad.tamanoTexto': 115,
      'accesibilidad.anchoLectura': true,
    },
  },
  {
    label: 'Alto contraste',
    detail: 'Bordes marcados y subrayado de enlaces.',
    values: { 'accesibilidad.altoContraste': true },
  },
  {
    label: RESET_LABEL,
    detail: 'Vuelve a los valores por defecto de accesibilidad y enfoque.',
    values: {
      'focus.modoEnfoque': undefined,
      'focus.unaPreguntaALaVez': undefined,
      'focus.temporizadorAutomatico': undefined,
      'accesibilidad.sinEmojis': undefined,
      'accesibilidad.ocultarRacha': undefined,
      'accesibilidad.reducirMovimiento': undefined,
      'accesibilidad.anchoLectura': undefined,
      'accesibilidad.fuenteLegible': undefined,
      'accesibilidad.espaciado': undefined,
      'accesibilidad.tamanoTexto': undefined,
      'accesibilidad.altoContraste': undefined,
    },
  },
];

/** Lo mínimo de `WorkspaceConfiguration` que usan los perfiles (permite probarlos sin VS Code). */
export interface ConfigLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown, target?: unknown): PromiseLike<void> | Promise<void>;
}

const sameValue = (a: unknown, b: unknown): boolean => a === b;

/** Un perfil está activo si todos sus ajustes tienen exactamente los valores del perfil. */
export function isProfileActive(p: { values: Record<string, unknown> }, c: ConfigLike): boolean {
  const entries = Object.entries(p.values).filter(([, v]) => v !== undefined);
  return entries.length > 0 && entries.every(([k, v]) => sameValue(c.get(k), v));
}

/**
 * Activa o desactiva un perfil. Al desactivarlo restaura sus ajustes por defecto y vuelve a
 * aplicar los demás perfiles que sigan activos (algunos comparten ajustes).
 * Devuelve true si el perfil quedó activo.
 */
export async function toggleProfile(
  profile: (typeof PROFILES)[number],
  c: ConfigLike,
  target: unknown = vscode.ConfigurationTarget.Global
): Promise<boolean> {
  const wasActive = isProfileActive(profile, c);
  if (!wasActive) {
    for (const [k, v] of Object.entries(profile.values)) await c.update(k, v, target);
    return true;
  }
  const others = PROFILES.filter((p) => p !== profile && p.label !== RESET_LABEL && isProfileActive(p, c));
  for (const k of Object.keys(profile.values)) await c.update(k, undefined, target);
  for (const o of others) {
    for (const [k, v] of Object.entries(o.values)) await c.update(k, v, target);
  }
  return false;
}

export async function resetProfiles(c: ConfigLike, target: unknown = vscode.ConfigurationTarget.Global): Promise<void> {
  const reset = PROFILES.find((p) => p.label === RESET_LABEL)!;
  for (const k of Object.keys(reset.values)) await c.update(k, undefined, target);
}

/**
 * Menú de perfiles: elegir uno lo activa o desactiva al instante (con Enter basta) y el menú
 * se vuelve a mostrar con el estado actualizado, hasta pulsar Esc.
 */
export async function pickProfiles(): Promise<void> {
  const c = cfg();
  for (;;) {
    const items = PROFILES.map((p) => {
      const reset = p.label === RESET_LABEL;
      const on = !reset && isProfileActive(p, c);
      return {
        label: reset ? '$(discard) ' + p.label : `${on ? '$(check)' : '$(circle-outline)'} ${p.label}`,
        description: reset ? '' : on ? 'ACTIVADO' : 'desactivado',
        detail: p.detail,
        p,
        reset,
      };
    });
    items.push({
      label: '$(gear) Ajustar cada opción en Ajustes…',
      description: '',
      detail: 'Abre Ajustes → Tutor para cambiar una por una.',
      p: PROFILES[0],
      reset: false,
      settings: true,
    } as (typeof items)[number] & { settings: boolean });

    const pick = await vscode.window.showQuickPick(items, {
      title: 'Accesibilidad y enfoque',
      placeHolder: 'Elige un perfil para activarlo o desactivarlo (Esc para terminar)',
      ignoreFocusOut: true,
    });
    if (!pick) return;
    try {
      if ((pick as { settings?: boolean }).settings) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'tutor.accesibilidad tutor.focus');
        return;
      }
      if (pick.reset) {
        await resetProfiles(c);
        void vscode.window.showInformationMessage('Tutor: accesibilidad y enfoque restablecidos a los valores por defecto.');
      } else {
        const on = await toggleProfile(pick.p, c);
        void vscode.window.showInformationMessage(`Tutor: «${pick.p.label}» ${on ? 'activado' : 'desactivado'}.`);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Tutor: no se pudo guardar el ajuste (${err instanceof Error ? err.message : err}). Puedes cambiarlo en Ajustes → Tutor.`
      );
      return;
    }
  }
}
