import type { EdgeKind } from "../import.js";

// The part of a document the index reads. A `GraphDocument` satisfies it; so does a test's
// literal, which is why it is not the whole document.
export interface GraphInput {
  readonly files: readonly { readonly path: string }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly kind: EdgeKind;
    readonly names?: readonly string[] | undefined;
  }[];
}

export interface Reached {
  readonly path: string;
  readonly depth: number;
}

export interface Dependency {
  readonly path: string;
  readonly dependents: number;
}

export interface FolderNode {
  readonly id: string;
  readonly files: number;
  readonly in: number;
  readonly out: number;
}

export interface FolderEdge {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

// Adjacency both ways over integer ids, built once: every query is linear in what it
// touches. Edges to paths not in `files` are dropped, as are duplicate pairs.
export class GraphIndex {
  private readonly ids = new Map<string, number>();
  private readonly paths: string[] = [];
  private readonly out: number[][] = [];
  private readonly in: number[][] = [];
  // Names imported into a file across all its incoming edges; `*` means all of them.
  private readonly importedNames: Set<string>[] = [];

  private constructor(input: GraphInput) {
    for (const file of input.files) this.idOf(file.path, true);
    const seen = new Set<number>();
    for (const edge of input.edges) {
      const from = this.ids.get(edge.from);
      const to = this.ids.get(edge.to);
      if (from === undefined || to === undefined) continue;
      for (const name of edge.names ?? ["*"]) this.importedNames[to]?.add(name);
      // Pair key: unique for any count below 2^26 files, far past the document's cap.
      const key = from * 67_108_864 + to;
      if (seen.has(key)) continue;
      seen.add(key);
      this.out[from]?.push(to);
      this.in[to]?.push(from);
    }
  }

  public static from(input: GraphInput): GraphIndex {
    return new GraphIndex(input);
  }

  public get size(): number {
    return this.paths.length;
  }

  public has(path: string): boolean {
    return this.ids.has(path);
  }

  public imports(path: string): readonly string[] {
    return this.names(this.out[this.ids.get(path) ?? -1] ?? []);
  }

  public importers(path: string): readonly string[] {
    return this.names(this.in[this.ids.get(path) ?? -1] ?? []);
  }

  // What `path` needs, transitively, nearest first. `depth` 1 is its direct imports.
  public dependencies(path: string, depth = Number.POSITIVE_INFINITY): readonly Reached[] {
    return this.walk(path, this.out, depth);
  }

  // What needs `path`, transitively, nearest first: everything a change to it can break.
  public dependents(path: string, depth = Number.POSITIVE_INFINITY): readonly Reached[] {
    return this.walk(path, this.in, depth);
  }

  // Every file a change to `path` reaches, nearest first. The explorer highlights it by depth.
  public impact(path: string): readonly Reached[] {
    return this.dependents(path);
  }

  // Tarjan's strongly connected components, iterative so a deep chain cannot overflow the
  // stack. A cycle is a component of two or more, or a file importing itself.
  public cycles(): readonly (readonly string[])[] {
    const count = this.paths.length;
    const index = new Int32Array(count).fill(-1);
    const low = new Int32Array(count);
    const onStack = new Uint8Array(count);
    const stack: number[] = [];
    const found: string[][] = [];
    let next = 0;

    for (let root = 0; root < count; root += 1) {
      if (index[root] !== -1) continue;
      // Each frame is a node and how far through its out-edges the walk has got.
      const frames: [number, number][] = [[root, 0]];
      index[root] = low[root] = next++;
      stack.push(root);
      onStack[root] = 1;

      while (frames.length > 0) {
        const frame = frames[frames.length - 1] as [number, number];
        const [node, at] = frame;
        const targets = this.out[node] ?? [];
        if (at < targets.length) {
          frame[1] = at + 1;
          const target = targets[at] as number;
          if (index[target] === -1) {
            index[target] = low[target] = next++;
            stack.push(target);
            onStack[target] = 1;
            frames.push([target, 0]);
          } else if (onStack[target]) {
            low[node] = Math.min(low[node] as number, index[target] as number);
          }
          continue;
        }
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent) low[parent[0]] = Math.min(low[parent[0]] as number, low[node] as number);
        if (low[node] !== index[node]) continue;

        const component: number[] = [];
        let member: number;
        do {
          member = stack.pop() as number;
          onStack[member] = 0;
          component.push(member);
        } while (member !== node);
        const selfLoop = component.length === 1 && (this.out[node] ?? []).includes(node);
        if (component.length > 1 || selfLoop) found.push(this.names(component).toSorted());
      }
    }
    return found.toSorted((a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? ""));
  }

  // By how many distinct files import each one, most first; ties by path.
  public mostDepended(limit: number): readonly Dependency[] {
    return this.paths
      .map((path, id) => ({ path, dependents: this.in[id]?.length ?? 0 }))
      .filter((entry) => entry.dependents > 0)
      .toSorted((a, b) => b.dependents - a.dependents || a.path.localeCompare(b.path))
      .slice(0, limit);
  }

  // Files no entry point reaches. Entries themselves are never unused.
  public unusedFiles(entries: Iterable<string>): readonly string[] {
    const reached = new Uint8Array(this.paths.length);
    const queue: number[] = [];
    for (const entry of entries) {
      const id = this.ids.get(entry);
      if (id === undefined || reached[id]) continue;
      reached[id] = 1;
      queue.push(id);
    }
    for (let head = 0; head < queue.length; head += 1) {
      for (const target of this.out[queue[head] as number] ?? []) {
        if (reached[target]) continue;
        reached[target] = 1;
        queue.push(target);
      }
    }
    return this.paths.filter((_, id) => !reached[id]);
  }

  // Exports nothing imports by name. A file imported whole (`*`) has none unused.
  public unusedExports(
    exports: Iterable<{ readonly path: string; readonly exports: readonly string[] }>,
    entries: ReadonlySet<string> = new Set(),
  ): readonly { readonly path: string; readonly name: string }[] {
    const unused: { path: string; name: string }[] = [];
    for (const file of exports) {
      if (entries.has(file.path)) continue;
      const id = this.ids.get(file.path);
      const names = id === undefined ? undefined : this.importedNames[id];
      if (names?.has("*")) continue;
      for (const name of file.exports)
        if (!names?.has(name)) unused.push({ path: file.path, name });
    }
    return unused;
  }

  // Files grouped by their first `depth` folders, with the edges between groups counted.
  // An edge inside one group counts in neither `in` nor `out`.
  public folders(depth: number): {
    readonly nodes: readonly FolderNode[];
    readonly edges: readonly FolderEdge[];
  } {
    const groupOf = this.paths.map((path) => GraphIndex.folderOf(path, depth));
    const nodes = new Map<string, { files: number; in: number; out: number }>();
    for (const group of groupOf) {
      const node = nodes.get(group) ?? { files: 0, in: 0, out: 0 };
      node.files += 1;
      nodes.set(group, node);
    }
    const edges = new Map<string, FolderEdge>();
    this.out.forEach((targets, from) => {
      const source = groupOf[from] as string;
      for (const to of targets) {
        const target = groupOf[to] as string;
        if (source === target) continue;
        (nodes.get(source) as { out: number }).out += 1;
        (nodes.get(target) as { in: number }).in += 1;
        const key = `${source}\u0000${target}`;
        const held = edges.get(key);
        edges.set(key, { from: source, to: target, count: (held?.count ?? 0) + 1 });
      }
    });
    return {
      nodes: [...nodes]
        .map(([id, node]) => ({ id, ...node }))
        .toSorted((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges.values()],
    };
  }

  // `src/users/users.service.ts` at depth 2 is `src/users`; a file shallower than the depth
  // is its own folder's member, and a root file belongs to `.`.
  public static folderOf(path: string, depth: number): string {
    const parts = path.split("/");
    parts.pop();
    if (parts.length === 0) return ".";
    return parts.slice(0, Math.max(1, depth)).join("/");
  }

  private walk(path: string, adjacency: readonly number[][], depth: number): readonly Reached[] {
    const start = this.ids.get(path);
    if (start === undefined) return [];
    const distance = new Map<number, number>([[start, 0]]);
    const queue = [start];
    const reached: Reached[] = [];
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head] as number;
      const at = distance.get(node) as number;
      if (at >= depth) continue;
      for (const next of adjacency[node] ?? []) {
        if (distance.has(next)) continue;
        distance.set(next, at + 1);
        queue.push(next);
        reached.push({ path: this.paths[next] as string, depth: at + 1 });
      }
    }
    return reached;
  }

  private idOf(path: string, create: boolean): number | undefined {
    const known = this.ids.get(path);
    if (known !== undefined || !create) return known;
    const id = this.paths.length;
    this.ids.set(path, id);
    this.paths.push(path);
    this.out.push([]);
    this.in.push([]);
    this.importedNames.push(new Set());
    return id;
  }

  private names(ids: readonly number[]): string[] {
    return ids.map((id) => this.paths[id] as string);
  }
}
