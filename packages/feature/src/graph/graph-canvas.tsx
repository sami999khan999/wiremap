import type { CommentMark } from "../comment/index.js";
import {
  Background,
  Controls,
  type FlowEdge,
  type FlowNode,
  MiniMap,
  ReactFlow,
  useEffect,
  useMemo,
  useReactFlow,
} from "../import.js";
import type { Placed } from "./explorer-layout.js";
import type { ExplorerView, ViewEdge } from "./explorer-model.js";
import { FileNode, FolderNode, type NodeData } from "./graph-nodes.js";

const NODE_TYPES = { folder: FolderNode, file: FileNode };

// Colour from the twelve: imports muted, injections the warning tone, API calls primary.
// An edge whose target was inferred is dashed; a thicker one stands for more imports.
const strokeOf = (edge: ViewEdge) => ({
  stroke:
    edge.kind === "api"
      ? "var(--primary)"
      : edge.kind === "inject"
        ? "var(--warning)"
        : "var(--fg-muted)",
  strokeWidth: Math.min(4, 1 + Math.log2(edge.count)),
  strokeDasharray: edge.certain ? undefined : "4 4",
  opacity: edge.dimmed ? 0.12 : 0.7,
});

export interface GraphCanvasProps {
  readonly view: ExplorerView;
  readonly positions: ReadonlyMap<string, Placed>;
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
  selected,
  onSelect,
  onToggle,
  focus,
  marks,
}: GraphCanvasProps) {
  const flow = useReactFlow();

  const nodes = useMemo<FlowNode[]>(
    () =>
      view.nodes.map((node) => {
        const at = positions.get(node.id) ?? { x: 0, y: 0, width: 220, height: 40 };
        const data: NodeData = {
          view: node,
          selected: node.id === selected,
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
    [view, positions, selected, onToggle, marks],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      view.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        style: strokeOf(edge),
        zIndex: 3,
      })),
    [view],
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
      onNodeClick={(_, node) => onSelect(node.id)}
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
