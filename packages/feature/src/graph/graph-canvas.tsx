import type { CommentMark } from "../comment/index.js";
import {
  Background,
  Controls,
  type FlowEdge,
  type FlowNode,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEffect,
  useMemo,
  useReactFlow,
  useState,
} from "../import.js";
import type { Placed, Point } from "./explorer-layout.js";
import type { ExplorerView, ViewEdge } from "./explorer-model.js";
import { RouteEdge, type RouteEdgeData } from "./graph-edge.js";
import { FileNode, FolderNode, type NodeData } from "./graph-nodes.js";

const NODE_TYPES = { folder: FolderNode, file: FileNode };
const EDGE_TYPES = { route: RouteEdge };

type Emphasis = "lit" | "faded" | "normal";

// Colour from the twelve: imports muted, injections the warning tone, API calls primary.
// One width for every line: a thicker one merges with its neighbours into a rope.
const colourOf = (edge: ViewEdge) =>
  edge.kind === "api"
    ? "var(--primary)"
    : edge.kind === "inject"
      ? "var(--warning)"
      : "var(--fg-muted)";

const strokeOf = (edge: ViewEdge, emphasis: Emphasis) => ({
  stroke: emphasis === "lit" ? "var(--primary)" : colourOf(edge),
  strokeWidth: emphasis === "lit" ? 2 : 1,
  strokeDasharray: edge.certain ? undefined : "4 4",
  opacity: edge.dimmed || emphasis === "faded" ? 0.07 : emphasis === "lit" ? 1 : 0.45,
});

export interface GraphCanvasProps {
  readonly view: ExplorerView;
  readonly positions: ReadonlyMap<string, Placed>;
  readonly routes: ReadonlyMap<string, readonly Point[]>;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onToggle: (folder: string) => void;
  // A node to bring into view, set by search and by a click in a side panel.
  readonly focus: string | null;
  readonly marks?: ReadonlyMap<string, CommentMark> | undefined;
}

export function GraphCanvas({
  view,
  positions,
  routes,
  selected,
  onSelect,
  onToggle,
  focus,
  marks,
}: GraphCanvasProps) {
  const flow = useReactFlow();
  // Hover previews what a click pins: the node's own lines lit, everything unconnected faded.
  const [hovered, setHovered] = useState<string | null>(null);
  const focusNode = hovered ?? selected;
  const linked = useMemo(() => {
    if (!focusNode) return null;
    const nodes = new Set([focusNode]);
    const edges = new Set<string>();
    for (const edge of view.edges) {
      if (edge.source !== focusNode && edge.target !== focusNode) continue;
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
    return { nodes, edges };
  }, [view, focusNode]);

  const nodes = useMemo<FlowNode[]>(
    () =>
      view.nodes.map((node) => {
        const at = positions.get(node.id) ?? { x: 0, y: 0, width: 220, height: 40 };
        const open = node.kind === "folder" && node.expanded;
        const data: NodeData = {
          view: node,
          selected: node.id === selected,
          // An open folder's frame stays clear, so the files inside it can still be read.
          faded: linked !== null && !linked.nodes.has(node.id) && !open,
          linked: linked?.nodes.has(node.id) === true && node.id !== focusNode,
          onToggle,
          mark: marks?.get(node.id) ?? null,
        };
        return {
          id: node.id,
          type: node.kind,
          position: { x: at.x, y: at.y },
          width: at.width,
          height: at.height,
          data,
          // A file sits inside its folder's frame and moves with it.
          ...(node.parent ? { parentId: node.parent, extent: "parent" as const } : {}),
          zIndex: node.kind === "file" ? 2 : node.expanded ? 0 : 1,
        };
      }),
    [view, positions, selected, onToggle, marks, linked, focusNode],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      view.edges.map((edge) => {
        const emphasis: Emphasis =
          linked === null ? "normal" : linked.edges.has(edge.id) ? "lit" : "faded";
        const style = strokeOf(edge, emphasis);
        const data: RouteEdgeData = { points: routes.get(edge.id) };
        return {
          id: edge.id,
          type: "route",
          source: edge.source,
          target: edge.target,
          data,
          style,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: style.stroke },
          // Lit lines are drawn last, over the faded ones they cross.
          zIndex: emphasis === "lit" ? 5 : 3,
        };
      }),
    [view, routes, linked],
  );

  // A new layout re-frames the canvas, unless the reader is looking at one node.
  useEffect(() => {
    if (focus || selected) return;
    const frame = requestAnimationFrame(
      () => void flow.fitView({ padding: 0.12, duration: 200, minZoom: 0.55, maxZoom: 1.2 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [positions, flow, focus, selected]);

  useEffect(() => {
    if (!focus) return;
    const node = flow.getInternalNode(focus);
    if (!node) return;
    const { x, y } = node.internals.positionAbsolute;
    void flow.setCenter(x + (node.measured.width ?? 0) / 2, y + (node.measured.height ?? 0) / 2, {
      zoom: 1.1,
      duration: 300,
    });
  }, [focus, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodeClick={(_, node) => onSelect(node.id === selected ? null : node.id)}
      onNodeMouseEnter={(_, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(null)}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      nodesDraggable={false}
      onlyRenderVisibleElements
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      className="ui-graph-canvas"
    >
      <Background color="var(--border)" gap={24} />
      <MiniMap
        pannable
        zoomable
        maskColor="color-mix(in oklch, var(--bg) 70%, transparent)"
        nodeColor="var(--muted)"
        className="!bg-surface"
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
