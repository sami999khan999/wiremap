import type { ElkExtendedEdge, ElkNode } from "../import.js";
import type { ExplorerView } from "./explorer-model.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Lays an ELK graph out. The app hands one in that runs ELK in a web worker; without one,
// the grid below places nodes at once so the canvas is never blank.
export type GraphLayouter = (graph: ElkNode) => Promise<ElkNode>;

// The view as an ELK graph and back. An expanded folder is a parent whose children are its
// files, laid out inside it; edges are listed at the root and routed across the hierarchy.
export class ExplorerLayout {
  public static readonly FOLDER = { width: 260, height: 80 } as const;
  public static readonly FILE = { width: 240, height: 40 } as const;

  private constructor() {}

  public static toElk(view: ExplorerView): ElkNode {
    const children = new Map<string, ElkNode[]>();
    for (const node of view.nodes) {
      if (node.kind !== "file" || !node.parent) continue;
      const list = children.get(node.parent) ?? [];
      list.push({ id: node.id, ...ExplorerLayout.FILE });
      children.set(node.parent, list);
    }
    const edges: ElkExtendedEdge[] = view.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));
    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.spacing.nodeNode": "32",
        "elk.layered.spacing.nodeNodeBetweenLayers": "120",
        // Every edge gets its own track and its own point on a node's side, so twenty edges
        // into one node read as twenty lines rather than as one thick rope.
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.mergeEdges": "false",
        "elk.spacing.edgeEdge": "6",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "6",
        "elk.layered.spacing.edgeNodeBetweenLayers": "20",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      },
      children: view.nodes
        .filter((node) => node.kind === "folder")
        .map((node) =>
          node.expanded
            ? {
                id: node.id,
                layoutOptions: { "elk.padding": "[top=48,left=16,bottom=16,right=16]" },
                children: children.get(node.id) ?? [],
              }
            : { id: node.id, ...ExplorerLayout.FOLDER },
        ),
      edges,
    };
  }

  // Positions relative to each node's parent, which is what React Flow wants for children.
  public static positions(laid: ElkNode): Map<string, Placed> {
    const placed = new Map<string, Placed>();
    const visit = (node: ElkNode) => {
      for (const child of node.children ?? []) {
        placed.set(child.id, {
          x: child.x ?? 0,
          y: child.y ?? 0,
          width: child.width ?? ExplorerLayout.FOLDER.width,
          height: child.height ?? ExplorerLayout.FOLDER.height,
        });
        visit(child);
      }
    };
    visit(laid);
    return placed;
  }

  // Each edge's route in canvas coordinates. ELK gives a section relative to the node that
  // contains the edge, so that node's absolute offset is added back.
  public static routes(laid: ElkNode): Map<string, readonly Point[]> {
    const offsets = new Map<string, Point>([["root", { x: 0, y: 0 }]]);
    const place = (node: ElkNode, origin: Point) => {
      for (const child of node.children ?? []) {
        const at = { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) };
        offsets.set(child.id, at);
        place(child, at);
      }
    };
    place(laid, { x: 0, y: 0 });

    const routes = new Map<string, readonly Point[]>();
    const collect = (node: ElkNode) => {
      for (const edge of node.edges ?? []) {
        const container = (edge as { container?: string }).container ?? node.id;
        const origin = offsets.get(container) ?? { x: 0, y: 0 };
        const points = (edge.sections ?? []).flatMap((section) => [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ]);
        if (points.length >= 2)
          routes.set(
            edge.id,
            points.map((point) => ({ x: origin.x + point.x, y: origin.y + point.y })),
          );
      }
      for (const child of node.children ?? []) collect(child);
    };
    collect(laid);
    return routes;
  }

  // A grid with expanded folders sized to their files: instant, used until ELK answers.
  public static grid(view: ExplorerView): Map<string, Placed> {
    const placed = new Map<string, Placed>();
    const columns = 4;
    let column = 0;
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const folder of view.nodes.filter((node) => node.kind === "folder")) {
      const files = view.nodes.filter((node) => node.parent === folder.id);
      const height = folder.expanded
        ? 56 + files.length * (ExplorerLayout.FILE.height + 8)
        : ExplorerLayout.FOLDER.height;
      const width = folder.expanded ? ExplorerLayout.FILE.width + 32 : ExplorerLayout.FOLDER.width;
      placed.set(folder.id, { x, y, width, height });
      files.forEach((file, index) => {
        placed.set(file.id, {
          x: 16,
          y: 48 + index * (ExplorerLayout.FILE.height + 8),
          ...ExplorerLayout.FILE,
        });
      });
      rowHeight = Math.max(rowHeight, height);
      column += 1;
      x += width + 48;
      if (column === columns) {
        column = 0;
        x = 0;
        y += rowHeight + 48;
        rowHeight = 0;
      }
    }
    return placed;
  }
}
