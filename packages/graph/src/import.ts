// Everything this package takes from outside itself, in one place. Types only: the graph
// algorithms carry no runtime dependency, so the browser bundle pays for nothing but them.

// ── @loadbearing/contracts ───────────────────────────────────────────────────
export type {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphFile,
  GraphRoute,
} from "@loadbearing/contracts";
