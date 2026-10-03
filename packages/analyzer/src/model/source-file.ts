import type { FileRole, GraphLanguage, SyntaxNode, Tree, ts } from "../import.js";

// One import as written. `names` are what it takes: `default`, a named export, or `*` for a
// namespace, a re-export of everything, or a side-effect import.
export interface ImportRef {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly line: number;
  // PHP's implicit references (`extends Base` in the same namespace) are not imports a
  // reader wrote, so they make edges but never count against coverage.
  readonly implicit?: boolean;
}

export interface SourceFile {
  // Unique in the document: relative to the repository, prefixed with it when there are many.
  readonly path: string;
  // Relative to the repository root, `/`-separated: what plugins match on.
  readonly local: string;
  readonly absolute: string;
  readonly repository: string;
  // The folder of the package or composer project that owns the file, `""` at the root.
  readonly packageDir: string;
  readonly language: GraphLanguage;
  readonly text: string;
  readonly loc: number;
}

export interface ParsedFile extends SourceFile {
  readonly imports: readonly ImportRef[];
  readonly exports: readonly string[];
  // One of the two, by language; plugins read whichever their framework is written in.
  readonly typescript?: ts.SourceFile;
  readonly php?: {
    readonly tree: Tree;
    readonly root: SyntaxNode;
    readonly namespace: string | null;
    readonly uses: ReadonlyMap<string, string>;
  };
  role: FileRole;
}
