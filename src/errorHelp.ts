import * as vscode from 'vscode';
import { parseErrorLocations } from './pure';

const enabled = (): boolean => vscode.workspace.getConfiguration('tutor').get<boolean>('erroresEnEditor', true);

/**
 * Errores de la última ejecución o prueba, dentro del editor:
 *  - subrayado en la línea que señala el compilador o el intérprete (pestaña Problemas);
 *  - acción rápida «¿qué significa este error?» sobre cada subrayado;
 *  - CodeLens en la primera línea cuando algo falló, aunque no haya línea (p. ej. salida distinta).
 * Todo lleva al chat del tutor, que orienta sin dar la solución.
 */
export class ErrorHelp implements vscode.CodeActionProvider, vscode.CodeLensProvider, vscode.Disposable {
  private diagnostics = vscode.languages.createDiagnosticCollection('tutor');
  /** Archivos del alumno cuya última ejecución o prueba falló. */
  private failing = new Set<string>();
  private lensChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChanged.event;
  private subs: vscode.Disposable[];

  constructor() {
    const selector: vscode.DocumentSelector = { scheme: 'file' };
    this.subs = [
      this.diagnostics,
      this.lensChanged,
      vscode.languages.registerCodeActionsProvider(selector, this, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
      vscode.languages.registerCodeLensProvider(selector, this),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tutor.erroresEnEditor') && !enabled()) this.clearAll();
      }),
    ];
  }

  /** Muestra en el editor el resultado de correr o probar `file`. `ok`: sin errores (borra lo anterior). */
  report(file: string, ok: boolean, output: string): void {
    const uri = vscode.Uri.file(file);
    if (ok || !enabled()) {
      this.diagnostics.delete(uri);
      this.failing.delete(file);
    } else {
      this.diagnostics.set(
        uri,
        parseErrorLocations(output, file).map((e) => {
          // sin columna se marca la línea entera; con ella, desde la columna (VS Code recorta al final de la línea)
          const range = new vscode.Range(e.line - 1, (e.col ?? 1) - 1, e.line - 1, Number.MAX_SAFE_INTEGER);
          const d = new vscode.Diagnostic(
            range,
            e.message,
            e.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
          );
          d.source = 'Tutor';
          return d;
        })
      );
      this.failing.add(file);
    }
    this.lensChanged.fire();
  }

  private clearAll(): void {
    this.diagnostics.clear();
    this.failing.clear();
    this.lensChanged.fire();
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    return ctx.diagnostics
      .filter((d) => d.source === 'Tutor')
      .map((d) => {
        const action = new vscode.CodeAction('Tutor: ¿qué significa este error?', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [d];
        action.command = {
          command: 'tutor.explainError',
          title: 'Preguntar al tutor',
          arguments: [doc.uri, d.range.start.line + 1, d.message],
        };
        return action;
      });
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!enabled() || !this.failing.has(doc.uri.fsPath)) return [];
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: '$(question) ¿Por qué falla? Pregunta al tutor',
        tooltip: 'El tutor ve tu código y la salida de la última ejecución; te orienta sin darte la solución.',
        command: 'tutor.explainError',
        arguments: [doc.uri],
      }),
    ];
  }

  dispose(): void {
    vscode.Disposable.from(...this.subs).dispose();
  }
}

/** Pregunta para el chat: sobre una línea concreta o sobre el último fallo en general. */
export function explainPrompt(line?: number, message?: string): string {
  if (line && message) {
    return `En la línea ${line} de mi código aparece este error:\n\n${message}\n\n¿Qué significa? Guíame para encontrar la causa sin darme el código corregido.`;
  }
  return 'Mi última ejecución o mis pruebas fallaron. ¿Qué crees que está pasando? Guíame para encontrarlo sin darme la solución.';
}
