import { FileFacts, FileTreeProvider, GraphSource } from "./extension/index.js";
import { vscode } from "./import.js";

const KEY = "wiremap.apiKey";

// The editor's entry points. VS Code calls `activate` once, after start-up finishes.
export function activate(context: vscode.ExtensionContext): void {
  const tree = new FileTreeProvider();
  const source = new GraphSource();
  let facts: FileFacts | null = null;

  const settings = () => vscode.workspace.getConfiguration("wiremap");
  const folder = () => vscode.workspace.workspaceFolders?.[0] ?? null;
  const activePath = (): string | null => {
    const editor = vscode.window.activeTextEditor;
    const root = folder();
    if (!editor || !root || !facts) return null;
    return facts.pathOf(root.uri.fsPath, editor.document.uri.fsPath);
  };

  const render = () => {
    const root = folder();
    if (!root) return tree.message("Open a folder to see how its files are wired.");
    if (!facts) return tree.message("No graph loaded.");
    const path = activePath();
    const found = path ? facts.of(path) : null;
    if (!path || !found) return tree.message("This file is not in the graph.");
    tree.show(found, root.uri, facts.impact(path).dependents.length);
  };

  const reload = async () => {
    const root = folder();
    if (!root) return render();
    try {
      const loaded = await source.load({
        workspaceRoot: root.uri.fsPath,
        graphFile: settings().get<string>("graphFile", "graph.json"),
        server: settings().get<string>("server", ""),
        project: settings().get<string>("project", ""),
        apiKey: (await context.secrets.get(KEY)) ?? null,
      });
      if ("missing" in loaded) {
        facts = null;
        tree.message(`No graph: ${loaded.missing}.`);
        return;
      }
      facts = new FileFacts(loaded.document);
      render();
    } catch (error) {
      facts = null;
      tree.message(`The graph did not load: ${(error as Error).message}`);
    }
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("wiremap.file", tree),
    vscode.window.onDidChangeActiveTextEditor(render),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("wiremap")) void reload();
    }),
    vscode.commands.registerCommand("wiremap.reload", reload),
    vscode.commands.registerCommand("wiremap.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "A wiremap API key holding project.graph.read",
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await context.secrets.store(KEY, key.trim());
      await reload();
    }),
    vscode.commands.registerCommand("wiremap.showImpact", async () => {
      const path = activePath();
      const root = folder();
      if (!path || !facts || !root)
        return void vscode.window.showInformationMessage("This file is not in the graph.");
      const impact = facts.impact(path);
      const picked = await vscode.window.showQuickPick(
        [
          ...impact.dependents.map((reached) => ({
            label: reached.path,
            description: `${reached.depth} ${reached.depth === 1 ? "hop" : "hops"} away`,
            path: reached.path,
            line: 1,
          })),
          ...impact.routes.map((route) => ({
            label: `${route.method} ${route.path}`,
            description: `${route.file}:${route.line}`,
            path: route.file,
            line: route.line,
          })),
        ],
        {
          title: `${impact.dependents.length} files and ${impact.routes.length} routes depend on ${path}`,
        },
      );
      if (!picked) return;
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(root.uri, picked.path),
      );
      await vscode.window.showTextDocument(document, {
        selection: new vscode.Range(picked.line - 1, 0, picked.line - 1, 0),
      });
    }),
    vscode.commands.registerCommand("wiremap.openInWiremap", async () => {
      const server = settings().get<string>("server", "").replace(/\/+$/, "");
      const project = settings().get<string>("project", "");
      if (!server || !project)
        return void vscode.window.showInformationMessage("Set wiremap.server and wiremap.project.");
      const path = activePath();
      const url = `${server}/p/${encodeURIComponent(project)}${path ? `?sel=${encodeURIComponent(path)}` : ""}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  void reload();
}

export function deactivate(): void {}
