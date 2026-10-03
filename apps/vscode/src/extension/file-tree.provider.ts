import { vscode } from "../import.js";
import type { Facts } from "./file-facts.js";

// A row of the view: a heading with children, or a leaf that may open a file.
export class FileTreeItem extends vscode.TreeItem {
  public constructor(
    label: string,
    public readonly children: readonly FileTreeItem[] = [],
    options: { description?: string; file?: vscode.Uri; line?: number; icon?: string } = {},
  ) {
    super(
      label,
      children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.description = options.description;
    if (options.icon) this.iconPath = new vscode.ThemeIcon(options.icon);
    if (options.file) {
      this.resourceUri = options.file;
      this.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [
          options.file,
          options.line
            ? { selection: new vscode.Range(options.line - 1, 0, options.line - 1, 0) }
            : {},
        ],
      };
    }
  }
}

// The active file as the graph sees it: its role, its imports, what imports it, and the
// routes its handlers serve. A message in place of all four when there is nothing to show.
export class FileTreeProvider implements vscode.TreeDataProvider<FileTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  private rows: readonly FileTreeItem[] = [];

  public readonly onDidChangeTreeData = this.changed.event;

  public show(facts: Facts, root: vscode.Uri, impact: number): void {
    const open = (path: string) => vscode.Uri.joinPath(root, path);
    const files = (paths: readonly string[]) =>
      paths.map((path) => new FileTreeItem(path, [], { file: open(path), icon: "file" }));
    this.rows = [
      new FileTreeItem(facts.role, [], { description: `${facts.loc} lines`, icon: "symbol-class" }),
      new FileTreeItem(`Imports (${facts.imports.length})`, files(facts.imports)),
      new FileTreeItem(`Imported by (${facts.importers.length})`, files(facts.importers)),
      new FileTreeItem(
        `Routes (${facts.routes.length})`,
        facts.routes.map(
          (route) =>
            new FileTreeItem(`${route.method} ${route.path}`, [], {
              description: `line ${route.line}`,
              file: open(route.file),
              line: route.line,
              icon: "globe",
            }),
        ),
      ),
      new FileTreeItem(`${impact} files depend on this`, [], {
        description: "wiremap: Show impact",
        icon: "pulse",
      }),
    ];
    this.changed.fire();
  }

  public message(text: string): void {
    this.rows = [new FileTreeItem(text, [], { icon: "info" })];
    this.changed.fire();
  }

  public getTreeItem(item: FileTreeItem): FileTreeItem {
    return item;
  }

  public getChildren(item?: FileTreeItem): FileTreeItem[] {
    return [...(item ? item.children : this.rows)];
  }
}
