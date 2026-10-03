import { useMessages } from "../i18n/index.js";
import { type GraphDocument, type ReactNode, useState } from "../import.js";
import { CycleRing } from "./cycle-ring.js";
import type { RenderPath } from "./path-link.js";

const SHOWN = 20;

function Section({
  title,
  hint,
  count,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <header>
        <h2 className="m-0 flex items-baseline gap-2 text-base font-semibold">
          {title} <span className="text-sm font-normal text-fg-muted">{count}</span>
        </h2>
        <p className="m-0 text-xs text-fg-muted">{hint}</p>
      </header>
      {children}
    </section>
  );
}

function Capped<T>({
  items,
  render,
}: {
  readonly items: readonly T[];
  readonly render: (item: T) => ReactNode;
}) {
  const { t } = useMessages("graph");
  const [all, setAll] = useState(false);
  if (items.length === 0) return <p className="m-0 text-sm text-fg-muted">{t("insight.none")}</p>;
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(all ? items : items.slice(0, SHOWN)).map(render)}
      </ul>
      {!all && items.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-xs text-fg-muted hover:text-fg"
        >
          {t("insight.more", { count: items.length - SHOWN })}
        </button>
      ) : null}
    </>
  );
}

// The four things a scan computes about a project, each entry a link into the graph.
export function InsightsOverview({
  document,
  renderPath,
}: {
  readonly document: GraphDocument;
  readonly renderPath: RenderPath;
}) {
  const { t } = useMessages("graph");
  const { insights } = document;
  const routes = new Map(document.routes.map((route) => [route.id, route]));
  const mono = (text: string) => <span className="font-mono text-xs">{text}</span>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title={t("insight.mostDepended")}
        hint={t("insight.mostDepended.hint")}
        count={insights.mostDepended.length}
      >
        <Capped
          items={insights.mostDepended}
          render={(entry) => (
            <li key={entry.path} className="flex items-baseline justify-between gap-2">
              {renderPath(entry.path, mono(entry.path))}
              <span className="shrink-0 text-xs text-fg-muted">{entry.dependents}</span>
            </li>
          )}
        />
      </Section>
      <Section
        title={t("insight.cycles")}
        hint={t("insight.cycles.hint")}
        count={insights.cycles.length}
      >
        <Capped
          items={insights.cycles}
          render={(cycle) => (
            <li
              key={cycle.join("|")}
              className="flex items-center gap-3 border-b border-border py-2 last:border-0"
            >
              <CycleRing size={cycle.length} />
              <ol className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">
                {cycle.map((path) => (
                  <li key={path} className="truncate">
                    {renderPath(path, mono(path))}
                  </li>
                ))}
              </ol>
            </li>
          )}
        />
      </Section>
      <Section
        title={t("insight.unguarded")}
        hint={t("insight.unguarded.hint")}
        count={insights.unguardedRoutes.length}
      >
        <Capped
          items={insights.unguardedRoutes}
          render={(id) => {
            const route = routes.get(id);
            return (
              <li key={id} className="flex items-baseline justify-between gap-2">
                {mono(id)}
                {route
                  ? renderPath(
                      route.file,
                      <span className="font-mono text-[11px] text-fg-muted">
                        {route.file.split("/").pop()}:{route.line}
                      </span>,
                    )
                  : null}
              </li>
            );
          }}
        />
      </Section>
      <Section
        title={t("insight.unusedFiles")}
        hint={t("insight.unusedFiles.hint")}
        count={insights.unusedFiles.length}
      >
        <Capped
          items={insights.unusedFiles}
          render={(path) => <li key={path}>{renderPath(path, mono(path))}</li>}
        />
      </Section>
      <Section
        title={t("insight.unusedExports")}
        hint={t("insight.unusedExports.hint")}
        count={insights.unusedExports.length}
      >
        <Capped
          items={insights.unusedExports}
          render={(entry) => (
            <li
              key={`${entry.path}#${entry.name}`}
              className="flex items-baseline justify-between gap-2"
            >
              {mono(entry.name)}
              {renderPath(
                entry.path,
                <span className="truncate font-mono text-[11px] text-fg-muted">{entry.path}</span>,
              )}
            </li>
          )}
        />
      </Section>
    </div>
  );
}
