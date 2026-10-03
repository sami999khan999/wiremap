import type { CommentMark } from "../comment/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type CommentTarget,
  type GraphDocument,
  GraphIndex,
  ReactFlowProvider,
  type ReactNode,
  ResizablePanels,
  Tabs,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "../import.js";
import { ExplorerLayout, type GraphLayouter, type Placed } from "./explorer-layout.js";
import { ExplorerModel, type ExplorerState } from "./explorer-model.js";
import { GraphCanvas } from "./graph-canvas.js";
import { GraphSearch } from "./graph-search.js";
import { NodeDetail } from "./node-detail.js";
import { OverviewPanel } from "./overview-panel.js";
import { PartialBanner } from "./partial-banner.js";
import { RoleSidebar } from "./role-sidebar.js";

export interface GraphExplorerProps {
  readonly document: GraphDocument;
  readonly state: ExplorerState;
  // Partial changes; the route merges them into the URL, so every view is a link.
  readonly onState: (change: Partial<ExplorerState>) => void;
  // ELK in a worker, from the app. Without it the grid layout is used.
  readonly layout?: GraphLayouter;
  // The scan picker and saved views, above the canvas.
  readonly toolbar?: ReactNode;
  // The Ask tab, when Ask is on for the organization; absent, the tab is not shown at all.
  readonly renderAsk?: (selected: string | null, select: (path: string) => void) => ReactNode;
  // Comments, when the route has them: counts and pins on the canvas, a thread under a
  // node's detail, and the notes in the overview.
  readonly comments?: {
    readonly marks: ReadonlyMap<string, CommentMark>;
    readonly thread: (target: CommentTarget) => ReactNode;
    readonly notes: (select: (path: string) => void) => ReactNode;
  };
}

// Roles on the left, the canvas in the middle, the overview or a node's detail on the
// right. The whole of it fills the viewport under the shell.
export function GraphExplorer({
  document,
  state,
  onState,
  layout,
  toolbar,
  renderAsk,
  comments,
}: GraphExplorerProps) {
  const { t } = useMessages("graph");
  const view = useMemo(() => ExplorerModel.build(document, state), [document, state]);
  const [positions, setPositions] = useState<ReadonlyMap<string, Placed>>(() =>
    ExplorerLayout.grid(view),
  );
  // A selection arriving in the URL is brought into view on first paint, like a click.
  const [focus, setFocus] = useState<string | null>(state.selected);
  const [tab, setTab] = useState("overview");

  // The grid at once, then ELK's layout when it answers, unless the view moved on meanwhile.
  useEffect(() => {
    setPositions(ExplorerLayout.grid(view));
    if (!layout) return;
    let current = true;
    layout(ExplorerLayout.toElk(view))
      .then((laid) => {
        if (current) setPositions(ExplorerLayout.positions(laid));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [view, layout]);

  // Selecting a file opens its folder first, so the node exists to be centred on.
  const select = useCallback(
    (path: string | null) => {
      if (path === null) {
        onState({ selected: null, impact: false });
        return;
      }
      const isFile = document.files.some((file) => file.path === path);
      const folder = isFile ? GraphIndex.folderOf(path, state.depth) : path;
      const expanded =
        isFile && !state.expanded.has(folder)
          ? new Set([...state.expanded, folder])
          : state.expanded;
      onState({ selected: path, expanded, impact: state.selected === path ? state.impact : false });
      setFocus(path);
    },
    [document, state, onState],
  );

  const toggle = useCallback(
    (folder: string) => {
      const expanded = new Set(state.expanded);
      if (expanded.has(folder)) expanded.delete(folder);
      else expanded.add(folder);
      onState({ expanded });
    },
    [state.expanded, onState],
  );

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[480px] flex-col border-t border-border">
      <PartialBanner document={document} />
      <ResizablePanels
        className="min-h-0 flex-1"
        storageKey="wiremap.explorer"
        start={<RoleSidebar document={document} view={view} state={state} onState={onState} />}
        end={
          <Tabs
            label={t("graph.title")}
            value={renderAsk ? tab : "overview"}
            onValueChange={setTab}
            items={[
              {
                value: "overview",
                label: state.selected ? t("graph.tab.detail") : t("graph.tab.overview"),
              },
              ...(renderAsk ? [{ value: "ask", label: t("graph.tab.ask") }] : []),
            ]}
          >
            {(value) =>
              value === "ask" && renderAsk ? (
                renderAsk(state.selected, select)
              ) : state.selected ? (
                <div className="h-full overflow-y-auto">
                  <NodeDetail
                    document={document}
                    path={state.selected}
                    impact={state.impact}
                    onImpact={(impact) => onState({ impact })}
                    onSelect={select}
                    onClose={() => select(null)}
                    thread={comments?.thread({
                      kind: document.files.some((file) => file.path === state.selected)
                        ? "file"
                        : "folder",
                      key: state.selected,
                    })}
                  />
                </div>
              ) : (
                <div className="h-full overflow-y-auto">
                  <OverviewPanel
                    document={document}
                    onSelect={select}
                    notes={comments?.notes(select)}
                  />
                </div>
              )
            }
          </Tabs>
        }
      >
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
            <GraphSearch document={document} onSelect={select} />
            {toolbar}
          </div>
          <div className="min-h-0 flex-1">
            <ReactFlowProvider>
              <GraphCanvas
                view={view}
                positions={positions}
                selected={state.selected}
                onSelect={select}
                onToggle={toggle}
                focus={focus}
                marks={comments?.marks}
              />
            </ReactFlowProvider>
          </div>
        </div>
      </ResizablePanels>
    </div>
  );
}
