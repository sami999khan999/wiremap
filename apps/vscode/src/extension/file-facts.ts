import {
  type GraphDocument,
  GraphIndex,
  type GraphRoute,
  nodePath,
  type Reached,
} from "../import.js";

export interface Facts {
  readonly path: string;
  readonly role: string;
  readonly loc: number;
  readonly imports: readonly string[];
  readonly importers: readonly string[];
  readonly routes: readonly GraphRoute[];
}

export interface Impact {
  readonly dependents: readonly Reached[];
  readonly routes: readonly GraphRoute[];
}

// What the graph says about one file. No editor in here, so specs run it as it is.
export class FileFacts {
  private readonly index: GraphIndex;

  public constructor(public readonly document: GraphDocument) {
    this.index = GraphIndex.from(document);
  }

  // The graph names files relative to the repository root, with forward slashes. The
  // workspace folder is taken to be that root.
  public pathOf(workspaceRoot: string, absolute: string): string | null {
    const relative = nodePath.relative(workspaceRoot, absolute).split(nodePath.sep).join("/");
    if (relative.startsWith("..") || nodePath.isAbsolute(relative)) return null;
    return this.index.has(relative) ? relative : null;
  }

  public of(path: string): Facts | null {
    const file = this.document.files.find((each) => each.path === path);
    if (!file) return null;
    return {
      path,
      role: file.role,
      loc: file.loc,
      imports: this.index.imports(path),
      importers: this.index.importers(path),
      routes: this.document.routes.filter((route) => route.file === path),
    };
  }

  public impact(path: string): Impact {
    const dependents = this.index.impact(path);
    const touched = new Set([path, ...dependents.map((reached) => reached.path)]);
    return {
      dependents,
      routes: this.document.routes.filter((route) => touched.has(route.file)),
    };
  }
}
