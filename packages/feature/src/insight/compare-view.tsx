import { useMessages } from "../i18n/index.js";
import { GraphDiff, type GraphDocument, type ReactNode, useMemo } from "../import.js";
import type { RenderPath } from "./path-link.js";

function Changes({
  title,
  added,
  removed,
  render,
}: {
  readonly title: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly render: (item: string) => ReactNode;
}) {
  const { t } = useMessages("graph");
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {added.length === 0 && removed.length === 0 ? (
        <p className="m-0 text-sm text-fg-muted">{t("compare.same")}</p>
      ) : null}
      {added.length > 0 ? (
        <details open>
          <summary className="cursor-pointer text-sm text-success">
            {t("compare.added", { count: added.length })}
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 pl-4">
            {added.slice(0, 200).map((item) => (
              <li key={item}>{render(item)}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {removed.length > 0 ? (
        <details open>
          <summary className="cursor-pointer text-sm text-danger">
            {t("compare.removed", { count: removed.length })}
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 pl-4">
            {removed.slice(0, 200).map((item) => (
              <li key={item}>{render(item)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// Two scans side by side as what changed: files, imports, routes, and cycles that came or
// went. Computed here from the two documents with the same diff the server uses.
export function CompareView({
  before,
  after,
  renderPath,
}: {
  readonly before: GraphDocument;
  readonly after: GraphDocument;
  readonly renderPath: RenderPath;
}) {
  const { t } = useMessages("graph");
  const changes = useMemo(() => GraphDiff.between(before, after), [before, after]);
  const mono = (text: string) => <span className="font-mono text-xs">{text}</span>;
  const edge = (each: { from: string; to: string; kind: string }) =>
    `${each.from} → ${each.to}${each.kind === "import" ? "" : ` (${each.kind})`}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Changes
        title={t("compare.files")}
        added={changes.files.added}
        removed={changes.files.removed}
        render={(path) => renderPath(path, mono(path))}
      />
      <Changes
        title={t("compare.routes")}
        added={changes.routes.added}
        removed={changes.routes.removed}
        render={mono}
      />
      <Changes
        title={t("compare.edges")}
        added={changes.edges.added.map(edge)}
        removed={changes.edges.removed.map(edge)}
        render={mono}
      />
      <Changes
        title={`${t("compare.cyclesIntroduced")} / ${t("compare.cyclesFixed")}`}
        added={changes.cycles.introduced.map((cycle) => cycle.join(" → "))}
        removed={changes.cycles.fixed.map((cycle) => cycle.join(" → "))}
        render={mono}
      />
    </div>
  );
}
