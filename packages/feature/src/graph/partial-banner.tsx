import { useMessages } from "../i18n/index.js";
import { Button, Callout, type GraphDocument, useState } from "../import.js";

// "Graph is partial", with the imports that did not resolve one click away, grouped by what
// they asked for: a missing alias is usually one specifier repeated across many files.
export function PartialBanner({ document }: { readonly document: GraphDocument }) {
  const { t } = useMessages("graph");
  const [open, setOpen] = useState(false);
  const { resolved, total } = document.coverage;
  if (resolved >= total) return null;
  const percent = Math.round((resolved / total) * 100);
  const bySpecifier = new Map<string, number>();
  for (const miss of document.unresolved)
    bySpecifier.set(miss.specifier, (bySpecifier.get(miss.specifier) ?? 0) + 1);
  const rows = [...bySpecifier].toSorted((a, b) => b[1] - a[1]).slice(0, 50);

  return (
    <Callout tone="warning" className="m-0 rounded-none border-x-0 border-t-0 px-6">
      <div className="flex flex-wrap items-center gap-3">
        <span>{t("graph.partial", { resolved, total, percent })}</span>
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? t("graph.partial.hide") : t("graph.partial.show")}
        </Button>
      </div>
      {open ? (
        <ul className="m-0 mt-2 flex max-h-48 list-none flex-col gap-0.5 overflow-y-auto p-0 font-mono text-xs">
          {rows.map(([specifier, count]) => (
            <li key={specifier}>
              {specifier} <span className="text-fg-muted">×{count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Callout>
  );
}
