import { useMessages } from "../i18n/index.js";
import { type GraphDocument, GraphIndex, Input, useMemo } from "../import.js";
import type { RenderPath } from "./path-link.js";

export interface ImpactExplorerProps {
  readonly document: GraphDocument;
  readonly path: string | null;
  readonly onPath: (path: string | null) => void;
  readonly renderPath: RenderPath;
}

// "What does changing this file touch?": its dependents by distance, and every route whose
// handler is among them. API edges are left out: a call reaching a route is not an import.
export function ImpactExplorer({ document, path, onPath, renderPath }: ImpactExplorerProps) {
  const { t } = useMessages("graph");
  const index = useMemo(
    () =>
      GraphIndex.from({
        files: document.files,
        edges: document.edges.filter((edge) => edge.kind !== "api"),
      }),
    [document],
  );
  const known = path !== null && index.has(path);
  const reached = useMemo(() => (known && path ? index.impact(path) : []), [index, path, known]);
  const byDepth = new Map<number, string[]>();
  for (const each of reached)
    byDepth.set(each.depth, [...(byDepth.get(each.depth) ?? []), each.path]);
  const touched = new Set([...(path ? [path] : []), ...reached.map((each) => each.path)]);
  const routes = known ? document.routes.filter((route) => touched.has(route.file)) : [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header>
        <h2 className="m-0 text-base font-semibold">{t("impact.title")}</h2>
        <p className="m-0 text-xs text-fg-muted">{t("impact.intro")}</p>
      </header>
      <Input
        aria-label={t("impact.pick")}
        list="impact-files"
        placeholder={t("impact.placeholder")}
        defaultValue={path ?? ""}
        onChange={(event) => {
          const value = event.target.value.trim();
          if (value === "" || index.has(value)) onPath(value === "" ? null : value);
        }}
        className="font-mono"
      />
      <datalist id="impact-files">
        {document.files.map((file) => (
          <option key={file.path} value={file.path} />
        ))}
      </datalist>
      {known && path ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm">{t("impact.total", { count: reached.length, path })}</p>
            {[...byDepth].map(([depth, paths]) => (
              <details key={depth} open={depth <= 2}>
                <summary className="cursor-pointer text-sm text-fg-muted">
                  {t("impact.depth", { count: paths.length, depth })}
                </summary>
                <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 pl-4">
                  {paths.map((each) => (
                    <li key={each}>
                      {renderPath(each, <span className="font-mono text-xs">{each}</span>)}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">{t("impact.routes")}</h3>
            {routes.length === 0 ? (
              <p className="m-0 text-sm text-fg-muted">{t("impact.routes.none")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-xs">
                {routes.map((route) => (
                  <li key={route.id}>
                    <span className="font-semibold">{route.method}</span> {route.path}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
