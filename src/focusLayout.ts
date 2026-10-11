import * as vscode from 'vscode';

/**
 * Entorno despejado durante una sesión de enfoque: oculta minimapa, migas de pan y «sticky scroll».
 * Es reversible: se guardan los valores previos y se restauran al terminar (también si el editor
 * se cerró a mitad de sesión, al activarse la extensión).
 */
const SETTINGS: Record<string, unknown> = {
  'editor.minimap.enabled': false,
  'breadcrumbs.enabled': false,
  'editor.stickyScroll.enabled': false,
};
const BACKUP_KEY = 'tutor.layoutBackup';

type Backup = Record<string, { had: boolean; value: unknown }>;

export class FocusLayout {
  constructor(private context: vscode.ExtensionContext) {}

  get applied(): boolean {
    return !!this.context.globalState.get<Backup>(BACKUP_KEY);
  }

  async enter(): Promise<void> {
    if (this.applied) return;
    const backup: Backup = {};
    for (const key of Object.keys(SETTINGS)) {
      const info = vscode.workspace.getConfiguration().inspect(key);
      backup[key] = { had: info?.globalValue !== undefined, value: info?.globalValue };
    }
    await this.context.globalState.update(BACKUP_KEY, backup);
    for (const [key, value] of Object.entries(SETTINGS)) {
      try {
        await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
      } catch {
        /* un ajuste que este editor no tenga no debe impedir el resto */
      }
    }
  }

  async exit(): Promise<void> {
    const backup = this.context.globalState.get<Backup>(BACKUP_KEY);
    if (!backup) return;
    for (const [key, prev] of Object.entries(backup)) {
      try {
        await vscode.workspace.getConfiguration().update(key, prev.had ? prev.value : undefined, vscode.ConfigurationTarget.Global);
      } catch {
        /* ignorar */
      }
    }
    await this.context.globalState.update(BACKUP_KEY, undefined);
  }
}
