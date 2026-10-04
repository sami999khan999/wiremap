import type { CommentMark } from "../comment/index.js";
import { useMessages } from "../i18n/index.js";
import { Handle, Icon, type NodeProps, Position, RoleDot } from "../import.js";
import type { ViewNode } from "./explorer-model.js";
import { PLAIN_BUTTON, RoleTones } from "./role-tone.js";

export interface NodeData extends Record<string, unknown> {
  readonly view: ViewNode;
  readonly selected: boolean;
  // Another node is hovered or selected and this one is not connected to it.
  readonly faded?: boolean;
  // Connected to the hovered or selected node.
  readonly linked?: boolean;
  readonly onToggle: (folder: string) => void;
  readonly mark: CommentMark | null;
}

// Open comments and a pin when one is a note. Nothing at all on a node with neither.
function Mark({ mark }: { readonly mark: CommentMark | null }) {
  const { t } = useMessages("graph");
  if (!mark || (mark.count === 0 && !mark.pinned)) return null;
  return (
    <span
      title={t("comment.badge", { count: mark.count })}
      className="flex shrink-0 items-center gap-0.5 rounded-sm bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] px-1 text-[10px] text-fg"
    >
      <Icon name={mark.pinned ? "pin" : "comment"} size={10} />
      {mark.count > 0 ? mark.count : null}
    </span>
  );
}

const frame = (data: NodeData) =>
  [
    "rounded-lg border bg-surface text-fg shadow-sm transition-[opacity,border-color,box-shadow] duration-(--duration-fast)",
    data.selected
      ? "border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_25%,transparent)]"
      : data.linked
        ? "border-[color-mix(in_oklch,var(--primary)_55%,var(--border))]"
        : "border-border hover:border-[color-mix(in_oklch,var(--primary)_40%,var(--border))]",
    data.view.dimmed || data.faded ? "opacity-25" : "opacity-100",
  ].join(" ");

// `app/dashboard/accounting` as its last segment, with the path it sits in beneath it.
const split = (path: string) => {
  const cut = path.lastIndexOf("/");
  return cut === -1
    ? { name: path, parent: null }
    : { name: path.slice(cut + 1), parent: path.slice(0, cut) };
};

// A folder: its path, how many files and edges cross it, and its commonest role. Expanded,
// it is a frame its files sit in, and the same button folds it back.
export function FolderNode({ data }: NodeProps) {
  const node = data as NodeData;
  const { t } = useMessages("graph");
  const { view } = node;
  return (
    <div
      className={`${frame(node)} h-full w-full ${view.expanded ? "bg-[color-mix(in_oklch,var(--surface)_60%,transparent)]" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      <div className="flex items-start justify-between gap-2 px-3 py-2.5" title={view.label}>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold">{split(view.label).name}</div>
          {split(view.label).parent ? (
            <div className="truncate font-mono text-[10px] text-fg-muted">
              {split(view.label).parent}/
            </div>
          ) : null}
          <div className="mt-1 truncate text-[11px] text-fg-muted">
            {t("graph.folder.counts", { files: view.files, in: view.in, out: view.out })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Mark mark={node.mark} />
          {view.badge && !view.expanded ? (
            <span className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted">
              <RoleDot tone={RoleTones.of(view.badge)} />
              {view.badge}
            </span>
          ) : null}
          <button
            type="button"
            className={`${PLAIN_BUTTON} nodrag rounded-sm px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-muted hover:text-fg`}
            onClick={(event) => {
              event.stopPropagation();
              node.onToggle(view.id);
            }}
          >
            {view.expanded ? t("graph.collapse") : t("graph.expand")}
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />
    </div>
  );
}

// A file: its role's dot, its name, and its edges in and out.
export function FileNode({ data }: NodeProps) {
  const node = data as NodeData;
  const { t } = useMessages("graph");
  const { view } = node;
  return (
    <div className={`${frame(node)} flex h-full w-full items-center gap-2 px-3`} title={view.id}>
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      {view.role ? <RoleDot tone={RoleTones.of(view.role)} /> : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{view.label}</span>
      <span className="shrink-0 text-[10px] text-fg-muted">
        {t("graph.file.counts", { in: view.in, out: view.out })}
      </span>
      <Mark mark={node.mark} />
      {view.impactDepth !== null && view.impactDepth > 0 ? (
        <span className="shrink-0 rounded-sm bg-[color-mix(in_oklch,var(--warning)_25%,transparent)] px-1 text-[10px]">
          {view.impactDepth}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />
    </div>
  );
}
