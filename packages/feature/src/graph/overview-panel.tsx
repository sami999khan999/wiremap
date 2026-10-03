import { useMessages } from "../i18n/index.js";
import { Button, type GraphDocument, useState } from "../import.js";
import { PLAIN_BUTTON } from "./role-tone.js";

const SHOWN = 10;

// The project at a glance: what was scanned, how much of it, its routes, and the files the
// most others lean on. Every path is a link into the canvas.
export function OverviewPanel({
  document,
  onSelect,
}: {
  readonly document: GraphDocument;
  readonly onSelect: (path: string) => void;
}) {
  const { t } = useMessages("graph");
  const [allRoutes, setAllRoutes] = useState(false);
  const imports = document.edges.filter((edge) => edge.kind === "import").length;
  const routes = allRoutes ? document.routes : document.routes.slice(0, SHOWN);
  const fact = (label: string, value: string) => (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 p-3">
      <section className="flex flex-col gap-1">
        {fact(
          t("graph.overview.repositories"),
          document.meta.repositories.map((repository) => repository.name).join(", "),
        )}
        {fact(
          t("graph.overview.frameworks"),
          [...new Set(document.frameworks.map((framework) => framework.id))].join(", ") || "—",
        )}
        {fact(t("graph.overview.files"), String(document.files.length))}
        {fact(t("graph.overview.imports"), t("graph.overview.importsHere", { count: imports }))}
        {fact(t("graph.overview.routes"), String(document.routes.length))}
      </section>
      {document.routes.length > 0 ? (
        <section>
          <h3 className="m-0 mb-1 text-xs font-semibold uppercase text-fg-muted">
            {t("graph.overview.routes")}
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {routes.map((route) => (
              <li key={route.id} className="border-b border-border py-1.5 last:border-0">
                <div className="flex gap-2 font-mono text-xs">
                  <span className="w-12 shrink-0 font-semibold">{route.method}</span>
                  <span className="min-w-0 break-all">{route.path}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(route.file)}
                  className={`${PLAIN_BUTTON} ml-14 truncate font-mono text-[11px] text-fg-muted hover:text-fg`}
                >
                  {route.file.split("/").pop()}:{route.line}
                </button>
              </li>
            ))}
          </ul>
          {document.routes.length > SHOWN ? (
            <Button variant="ghost" onClick={() => setAllRoutes(!allRoutes)}>
              {allRoutes
                ? t("graph.overview.showFewer")
                : t("graph.overview.showAll", { count: document.routes.length })}
            </Button>
          ) : null}
        </section>
      ) : null}
      {document.insights.mostDepended.length > 0 ? (
        <section>
          <h3 className="m-0 mb-1 text-xs font-semibold uppercase text-fg-muted">
            {t("graph.overview.mostDepended")}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {document.insights.mostDepended.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.path)}
                  className={`${PLAIN_BUTTON} w-full rounded-sm px-1 py-0.5 text-left hover:bg-muted`}
                >
                  <span className="block truncate font-mono text-xs">{entry.path}</span>
                  <span className="text-[11px] text-fg-muted">
                    {t("graph.overview.importers", { count: entry.dependents })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
