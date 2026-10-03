import type { GraphDocument } from "../import.js";
import { GraphIndex } from "./graph-index.js";

type DiffInput = Pick<GraphDocument, "files" | "edges" | "routes">;

export interface EdgeRef {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
}

export interface GraphChanges {
  readonly files: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly edges: { readonly added: readonly EdgeRef[]; readonly removed: readonly EdgeRef[] };
  readonly routes: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly cycles: {
    readonly introduced: readonly (readonly string[])[];
    readonly fixed: readonly (readonly string[])[];
  };
}

// What changed from `before` to `after`: in the browser for the compare page, on the server
// for findings. Cycles are matched by their sorted members, so a reordered one is the same.
export class GraphDiff {
  private constructor() {}

  public static between(before: DiffInput, after: DiffInput): GraphChanges {
    const edgeKey = (edge: EdgeRef) => `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
    const cycleKey = (cycle: readonly string[]) => cycle.join("\u0000");
    const files = GraphDiff.sets(
      before.files.map((file) => file.path),
      after.files.map((file) => file.path),
    );
    const routes = GraphDiff.sets(
      before.routes.map((route) => route.id),
      after.routes.map((route) => route.id),
    );

    const beforeEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
    const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));
    const pick = ({ from, to, kind }: EdgeRef): EdgeRef => ({ from, to, kind });

    const beforeCycles = new Map(
      GraphIndex.from(before)
        .cycles()
        .map((cycle) => [cycleKey(cycle), cycle]),
    );
    const afterCycles = new Map(
      GraphIndex.from(after)
        .cycles()
        .map((cycle) => [cycleKey(cycle), cycle]),
    );

    return {
      files,
      routes,
      edges: {
        added: [...afterEdges]
          .filter(([key]) => !beforeEdges.has(key))
          .map(([, edge]) => pick(edge)),
        removed: [...beforeEdges]
          .filter(([key]) => !afterEdges.has(key))
          .map(([, edge]) => pick(edge)),
      },
      cycles: {
        introduced: [...afterCycles]
          .filter(([key]) => !beforeCycles.has(key))
          .map(([, cycle]) => cycle),
        fixed: [...beforeCycles].filter(([key]) => !afterCycles.has(key)).map(([, cycle]) => cycle),
      },
    };
  }

  private static sets(before: readonly string[], after: readonly string[]) {
    const was = new Set(before);
    const is = new Set(after);
    return {
      added: after.filter((item) => !was.has(item)).toSorted(),
      removed: before.filter((item) => !is.has(item)).toSorted(),
    };
  }
}
