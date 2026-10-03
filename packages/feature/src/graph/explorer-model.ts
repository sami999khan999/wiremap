import { type EdgeKind, type FileRole, type GraphDocument, GraphIndex } from "../import.js";

export interface ExplorerState {
  // Folder depth the canvas groups at; 2 is `src/users`.
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly role: FileRole | null;
  // Only files under this folder, when set.
  readonly folder: string | null;
  // Only files of this repository, when set.
  readonly repository: string | null;
  readonly selected: string | null;
  // Every file a change to the selected one reaches, when "Show impact" is on.
  readonly impact: boolean;
}

export interface ViewNode {
  readonly id: string;
  readonly kind: "folder" | "file";
  readonly label: string;
  // The folder an expanded file sits inside.
  readonly parent: string | null;
  readonly files: number;
  readonly in: number;
  readonly out: number;
  readonly role: FileRole | null;
  // The role most of a folder's files have, for its badge.
  readonly badge: FileRole | null;
  readonly expanded: boolean;
  readonly dimmed: boolean;
  // Distance from the selected file under "Show impact"; 0 is the file itself.
  readonly impactDepth: number | null;
}

export interface ViewEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
  readonly count: number;
  readonly certain: boolean;
  readonly dimmed: boolean;
}

export interface ExplorerView {
  readonly nodes: readonly ViewNode[];
  readonly edges: readonly ViewEdge[];
  // Files per role among the files the filters keep, for the sidebar.
  readonly roles: readonly { readonly role: FileRole; readonly count: number }[];
}

interface Tally {
  files: number;
  in: number;
  out: number;
  lit: boolean;
  roles: Map<FileRole, number>;
}

// The canvas as data: which folders and files show, which edges join them and how many
// imports each stands for, and what is dimmed. Pure and linear in files plus edges.
export class ExplorerModel {
  private constructor() {}

  public static build(document: GraphDocument, state: ExplorerState): ExplorerView {
    const files = document.files.filter(
      (file) =>
        (!state.folder || file.path.startsWith(`${state.folder}/`)) &&
        (!state.repository || file.repository === state.repository),
    );
    const roleOf = new Map(files.map((file) => [file.path, file.role]));
    const folderOf = (path: string) => GraphIndex.folderOf(path, state.depth);
    const unitOf = (path: string) => (state.expanded.has(folderOf(path)) ? path : folderOf(path));
    const impact =
      state.impact && state.selected ? ExplorerModel.impactOf(document, state.selected) : null;
    const lit = (path: string) =>
      (state.role === null || roleOf.get(path) === state.role) && (!impact || impact.has(path));
    const tally = (): Tally => ({ files: 0, in: 0, out: 0, lit: false, roles: new Map() });

    // Folders always; the files of an expanded folder as well.
    const folders = new Map<string, Tally>();
    const shown = new Map<string, Tally>();
    const roleCounts = new Map<FileRole, number>();
    for (const file of files) {
      roleCounts.set(file.role, (roleCounts.get(file.role) ?? 0) + 1);
      const folder = folders.get(folderOf(file.path)) ?? tally();
      folder.files += 1;
      folder.lit ||= lit(file.path);
      folder.roles.set(file.role, (folder.roles.get(file.role) ?? 0) + 1);
      folders.set(folderOf(file.path), folder);
      if (state.expanded.has(folderOf(file.path)))
        shown.set(file.path, { ...tally(), files: 1, lit: lit(file.path) });
    }

    const edges = new Map<
      string,
      { source: string; target: string; kind: EdgeKind; count: number; certain: boolean }
    >();
    for (const edge of document.edges) {
      if (!roleOf.has(edge.from) || !roleOf.has(edge.to)) continue;
      const fromFolder = folderOf(edge.from);
      const toFolder = folderOf(edge.to);
      if (fromFolder !== toFolder) {
        (folders.get(fromFolder) as Tally).out += 1;
        (folders.get(toFolder) as Tally).in += 1;
      }
      const source = unitOf(edge.from);
      const target = unitOf(edge.to);
      if (source === target) continue;
      const fromFile = shown.get(source);
      const toFile = shown.get(target);
      if (fromFile) fromFile.out += 1;
      if (toFile) toFile.in += 1;
      const key = `${edge.kind}\u0000${source}\u0000${target}`;
      const held = edges.get(key);
      if (held) {
        held.count += 1;
        held.certain &&= edge.certain;
      } else {
        edges.set(key, { source, target, kind: edge.kind, count: 1, certain: edge.certain });
      }
    }

    const filtering = state.role !== null || impact !== null;
    const nodes: ViewNode[] = [];
    for (const [id, folder] of folders) {
      nodes.push({
        id,
        kind: "folder",
        label: id,
        parent: null,
        files: folder.files,
        in: folder.in,
        out: folder.out,
        role: null,
        badge: [...folder.roles].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        expanded: state.expanded.has(id),
        dimmed: filtering && !folder.lit,
        impactDepth: null,
      });
    }
    for (const [path, file] of shown) {
      nodes.push({
        id: path,
        kind: "file",
        label: path.split("/").pop() ?? path,
        parent: folderOf(path),
        files: 1,
        in: file.in,
        out: file.out,
        role: roleOf.get(path) ?? null,
        badge: null,
        expanded: false,
        dimmed: filtering && !file.lit,
        impactDepth: impact?.get(path) ?? null,
      });
    }
    const dim = new Set(nodes.filter((node) => node.dimmed).map((node) => node.id));
    return {
      nodes: nodes.toSorted((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges.values()].map((edge) => ({
        ...edge,
        id: `${edge.kind}:${edge.source}->${edge.target}`,
        dimmed: dim.has(edge.source) || dim.has(edge.target),
      })),
      roles: [...roleCounts]
        .map(([role, count]) => ({ role, count }))
        .toSorted((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    };
  }

  // The selected file and everything depending on it, with each one's distance.
  public static impactOf(document: GraphDocument, path: string): Map<string, number> {
    const index = GraphIndex.from({
      files: document.files,
      edges: document.edges.filter((edge) => edge.kind !== "api"),
    });
    return new Map([
      [path, 0],
      ...index.impact(path).map((reached): [string, number] => [reached.path, reached.depth]),
    ]);
  }
}
