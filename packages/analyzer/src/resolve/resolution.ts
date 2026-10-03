// What an import turned into: an edge (`file`), a non-graph file (`outside`), an internal miss
// (`unresolved`), or a package (`external`), which coverage does not count.
export type Resolution =
  | { readonly kind: "file"; readonly local: string; readonly certain: boolean }
  | { readonly kind: "outside" }
  | { readonly kind: "unresolved" }
  | { readonly kind: "external" };
