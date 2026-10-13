import * as vscode from 'vscode';
import { Course } from './types';
import { DoubtEntry } from './pure';
import { DOUBTS_NAME, doubtsPath, listDoubts, onDoubtSaved } from './doubts';
import { noEmojis, stripEmoji } from './a11y';

/** Nodo de curso (o «General» si la duda se hizo sin curso activo). */
export class DoubtCourseItem extends vscode.TreeItem {
  constructor(public readonly course: Course | undefined, count: number, active: boolean) {
    super(
      course?.titulo ?? 'General',
      active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `doubts:${course?.id ?? '_general'}`;
    this.description = `${count} ${count === 1 ? 'duda' : 'dudas'}${active ? ' · curso actual' : ''}`;
    this.contextValue = 'doubtCourse';
    this.iconPath = new vscode.ThemeIcon('book');
  }
}

export class DoubtItem extends vscode.TreeItem {
  constructor(public readonly course: Course | undefined, public readonly entry: DoubtEntry) {
    super(entry.pregunta || '(sin texto)', vscode.TreeItemCollapsibleState.None);
    this.description = `${entry.dia} ${entry.hora} · ${entry.donde}`;
    const tip = new vscode.MarkdownString(`**${entry.pregunta}**\n\n_${entry.donde} · ${entry.dia} ${entry.hora}_\n\n---\n\n${entry.respuesta}`);
    tip.supportHtml = false;
    this.tooltip = tip;
    this.iconPath = new vscode.ThemeIcon('comment-discussion');
    this.contextValue = 'doubt';
    this.command = { command: 'tutor.openDoubt', title: 'Ver duda', arguments: [this] };
  }
}

type Node = DoubtCourseItem | DoubtItem;

/**
 * Vista «Dudas»: las preguntas al tutor agrupadas por curso. Cada curso guarda las suyas
 * en su propio `dudas-y-preguntas.md`, así que nunca se mezclan las de C con las de Python.
 */
export class DoubtsProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private subs: vscode.Disposable[] = [];

  constructor(private getCourses: () => Course[], private activeCourseId: () => string | undefined) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${DOUBTS_NAME}`);
    this.subs.push(
      watcher,
      watcher.onDidChange(() => this.refresh()),
      watcher.onDidCreate(() => this.refresh()),
      watcher.onDidDelete(() => this.refresh()),
      onDoubtSaved(() => this.refresh())
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (noEmojis() && typeof node.label === 'string') node.label = stripEmoji(node.label);
    return node;
  }

  getChildren(node?: Node): Node[] {
    if (node instanceof DoubtItem) return [];
    if (node instanceof DoubtCourseItem) {
      // la más reciente primero
      return listDoubts(node.course)
        .reverse()
        .map((e) => new DoubtItem(node.course, e));
    }
    const active = this.activeCourseId();
    const roots: DoubtCourseItem[] = [];
    try {
      for (const c of this.getCourses()) {
        const n = listDoubts(c).length;
        if (n || c.id === active) roots.push(new DoubtCourseItem(c, n, c.id === active));
      }
      const general = listDoubts(undefined).length;
      if (general) roots.push(new DoubtCourseItem(undefined, general, false));
    } catch {
      return []; // sin workspace
    }
    // el curso actual arriba
    return roots.sort((a, b) => Number(b.course?.id === active) - Number(a.course?.id === active));
  }
}

/** Abre el archivo de dudas del curso en la entrada pulsada. */
export async function revealDoubt(item: DoubtItem): Promise<void> {
  const file = doubtsPath(item.course);
  if (!file) return;
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
  const pos = new vscode.Position(item.entry.linea, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
}
