import * as vscode from 'vscode';
import { notify } from './a11y';
import { FocusLayout } from './focusLayout';
import { tutorState } from './state';

export type Phase = 'trabajo' | 'descanso';

export interface FocusSnapshot {
  active: boolean;
  paused: boolean;
  phase: Phase;
  remainingMs: number;
  totalMs: number;
  minutesToday: number;
  sessionsToday: number;
  solvedToday: number;
  goal: number;
}

const cfg = () => vscode.workspace.getConfiguration('tutor');

/**
 * Sesiones de enfoque (técnica Pomodoro configurable). Avisos suaves y sin sonido; siempre
 * puedes seguir, descansar o parar. Registra minutos y ejercicios del día, despeja el editor
 * mientras trabajas y avisa con delicadeza si llevas un rato sin actividad.
 */
export class FocusTimer {
  private item: vscode.StatusBarItem;
  private timer?: NodeJS.Timeout;
  private phase: Phase = 'trabajo';
  private endsAt = 0;
  private remainingMs = 0;
  private totalMs = 0;
  private paused = false;
  private ticking = false;
  private lastActivity = Date.now();
  private nudgedAt = 0;
  private emitter = new vscode.EventEmitter<FocusSnapshot>();
  readonly onDidChange = this.emitter.event;

  constructor(private layout: FocusLayout) {
    this.item = vscode.window.createStatusBarItem('tutor.status.focus', vscode.StatusBarAlignment.Left, 102);
    this.item.command = 'tutor.focusToggle';
    // recuperación: si el editor se cerró en plena sesión, se restaura el entorno
    if (this.layout.applied) void this.layout.exit();
  }

  dispose(): void {
    this.stopTimer();
    this.item.dispose();
    this.emitter.dispose();
    void this.layout.exit();
  }

  private minutes(phase: Phase): number {
    return phase === 'trabajo'
      ? Math.max(1, cfg().get<number>('focus.minutosTrabajo', 25))
      : Math.max(1, cfg().get<number>('focus.minutosDescanso', 5));
  }

  get active(): boolean {
    return this.ticking || this.paused;
  }

  snapshot(): FocusSnapshot {
    const day = tutorState.focusToday();
    const left = this.paused ? this.remainingMs : this.ticking ? Math.max(0, this.endsAt - Date.now()) : this.minutes(this.phase) * 60_000;
    return {
      active: this.active,
      paused: this.paused,
      phase: this.phase,
      remainingMs: left,
      totalMs: this.active ? this.totalMs : this.minutes(this.phase) * 60_000,
      minutesToday: day.minutos + this.elapsedWorkMinutes(),
      sessionsToday: day.sesiones,
      solvedToday: day.ejercicios,
      goal: Math.max(1, cfg().get<number>('focus.metaDiaria', 3)),
    };
  }

  /** Cualquier señal de actividad del alumno (teclear, cambiar de archivo…). */
  noteActivity(): void {
    this.lastActivity = Date.now();
  }

  /** Minutos completos trabajados en la fase en curso (se acreditan al terminar o parar). */
  private elapsedWorkMinutes(): number {
    if (this.phase !== 'trabajo' || !this.active) return 0;
    const left = this.paused ? this.remainingMs : Math.max(0, this.endsAt - Date.now());
    return Math.floor(Math.max(0, this.totalMs - left) / 60_000);
  }

  start(phase: Phase = 'trabajo'): void {
    this.phase = phase;
    this.totalMs = this.minutes(phase) * 60_000;
    this.remainingMs = this.totalMs;
    this.paused = false;
    this.lastActivity = Date.now();
    this.nudgedAt = 0;
    void (phase === 'trabajo' && cfg().get<boolean>('focus.limpiarEditor', false) ? this.layout.enter() : this.layout.exit());
    this.run();
  }

  private run(): void {
    this.stopTimer();
    this.endsAt = Date.now() + this.remainingMs;
    this.ticking = true;
    this.timer = setInterval(() => this.tick(), 1000);
    this.render();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.ticking = false;
  }

  pause(): void {
    if (!this.ticking) return;
    this.remainingMs = Math.max(0, this.endsAt - Date.now());
    this.stopTimer();
    this.paused = true;
    this.render();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastActivity = Date.now();
    this.run();
  }

  /** Acredita a las estadísticas los minutos trabajados de la fase actual. */
  private credit(): number {
    if (this.phase !== 'trabajo') return 0;
    const mins = this.elapsedWorkMinutes();
    if (mins > 0) tutorState.addFocus({ minutos: mins });
    return mins;
  }

  stop(): void {
    const wasWorking = this.active && this.phase === 'trabajo';
    const mins = wasWorking ? this.credit() : 0;
    this.stopTimer();
    this.paused = false;
    this.item.hide();
    void this.layout.exit();
    this.emit();
    if (mins > 0) notify(`Sesión terminada: ${mins} min de enfoque. Buen trabajo.`);
  }

  /** Un clic: iniciar, pausar o reanudar. */
  toggle(): void {
    if (!this.active) this.start('trabajo');
    else if (this.paused) this.resume();
    else this.pause();
  }

  skipBreak(): void {
    if (this.active && this.phase === 'descanso') this.start('trabajo');
  }

  private tick(): void {
    if (Date.now() >= this.endsAt) {
      this.finishPhase();
      return;
    }
    this.checkIdle();
    this.render();
  }

  /** Aviso suave (barra de estado, sin ventana) si llevas un rato sin tocar nada durante el trabajo. */
  private checkIdle(): void {
    const limit = cfg().get<number>('focus.avisoInactividad', 5) * 60_000;
    if (!limit || this.phase !== 'trabajo' || this.paused) return;
    const idle = Date.now() - this.lastActivity;
    if (idle >= limit && Date.now() - this.nudgedAt >= limit) {
      this.nudgedAt = Date.now();
      const left = Math.ceil(Math.max(0, this.endsAt - Date.now()) / 60_000);
      vscode.window.setStatusBarMessage(`Tutor: ¿seguimos? Te quedan ${left} min de esta sesión. Empieza con algo pequeño.`, 12_000);
    }
  }

  private finishPhase(): void {
    const wasWork = this.phase === 'trabajo';
    if (wasWork) {
      this.credit();
      tutorState.addFocus({ sesiones: 1 });
    }
    this.stopTimer();
    this.emit();
    void this.layout.exit();
    if (wasWork) {
      const day = tutorState.focusToday();
      this.item.text = '$(coffee) Descanso';
      void vscode.window
        .showInformationMessage(
          `Sesión completada. Hoy llevas ${day.minutos} min y ${day.ejercicios} ejercicio(s). Descansa ${this.minutes('descanso')} min: levántate, bebe agua, mira lejos 20 segundos.`,
          'Iniciar descanso',
          'Seguir trabajando',
          'Parar'
        )
        .then((p) => {
          if (p === 'Iniciar descanso') this.start('descanso');
          else if (p === 'Seguir trabajando') this.start('trabajo');
          else this.stop();
        });
    } else {
      void vscode.window
        .showInformationMessage('El descanso terminó. ¿Continuamos cuando quieras?', 'Empezar', 'Parar')
        .then((p) => (p === 'Empezar' ? this.start('trabajo') : this.stop()));
    }
  }

  private emit(): void {
    this.emitter.fire(this.snapshot());
  }

  private render(): void {
    const ms = this.paused ? this.remainingMs : Math.max(0, this.endsAt - Date.now());
    const s = Math.ceil(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    const icon = this.phase === 'trabajo' ? '$(target)' : '$(coffee)';
    this.item.text = `${icon} ${mm}:${ss}${this.paused ? ' (pausa)' : ''}`;
    this.item.tooltip = `${this.phase === 'trabajo' ? 'Enfoque' : 'Descanso'}. Click: ${this.paused ? 'reanudar' : 'pausar'}.`;
    this.item.show();
    this.emit();
  }

  /** Si el usuario pidió temporizador automático, arranca al abrir un ejercicio/lectura. */
  autoStart(): void {
    if (!this.active && cfg().get<boolean>('focus.temporizadorAutomatico', false)) {
      this.start('trabajo');
      notify('Temporizador de enfoque iniciado. Puedes pausarlo con un clic en la barra de estado.');
    }
  }
}
