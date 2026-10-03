import { useMessages } from "../i18n/index.js";
import {
  CommandDialog,
  type CommandGroup,
  type GraphDocument,
  useHotkey,
  useMemo,
  useState,
} from "../import.js";
import { PLAIN_BUTTON } from "./role-tone.js";

const LIMIT = 20;

// Ctrl/Cmd-K over files, exported names and routes. A result is an anchor, because the
// dialog follows Enter by clicking one; its click selects and centres the node.
export function GraphSearch({
  document,
  onSelect,
}: {
  readonly document: GraphDocument;
  readonly onSelect: (path: string) => void;
}) {
  const { t } = useMessages("graph");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useHotkey("k", () => setOpen(true), { mod: true });

  const groups = useMemo<CommandGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    const files = document.files
      .filter((file) => file.path.toLowerCase().includes(needle))
      .slice(0, LIMIT);
    const exports = document.files
      .flatMap((file) =>
        file.exports
          .filter((name) => name.toLowerCase().includes(needle))
          .map((name) => ({ name, path: file.path })),
      )
      .slice(0, LIMIT);
    const routes = document.routes
      .filter((route) => route.id.toLowerCase().includes(needle))
      .slice(0, LIMIT);
    return [
      {
        key: "files",
        label: t("graph.search.files"),
        items: files.map((file) => ({
          id: `f:${file.path}`,
          title: file.path,
          href: file.path,
          icon: "file" as const,
        })),
      },
      {
        key: "exports",
        label: t("graph.search.exports"),
        items: exports.map((entry) => ({
          id: `e:${entry.path}:${entry.name}`,
          title: entry.name,
          excerpt: entry.path,
          href: entry.path,
        })),
      },
      {
        key: "routes",
        label: t("graph.search.routes"),
        items: routes.map((route) => ({
          id: `r:${route.id}`,
          title: route.id,
          excerpt: `${route.file}:${route.line}`,
          href: route.file,
          icon: "route" as const,
        })),
      },
    ].filter((group) => group.items.length > 0);
  }, [document, query, t]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${PLAIN_BUTTON} rounded-md border border-solid border-border !bg-surface px-3 py-1.5 text-left text-sm text-fg-muted hover:text-fg`}
      >
        {t("graph.search")} <kbd className="ml-2 text-xs">⌘K</kbd>
      </button>
      <CommandDialog
        label={t("graph.search")}
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        placeholder={t("graph.search")}
        emptyLabel={t("graph.search.empty")}
        groups={groups}
        renderLink={(item, content, attributes) => (
          <a
            href={`#${item.href}`}
            className={attributes.className}
            onClick={(event) => {
              event.preventDefault();
              onSelect(item.href);
            }}
          >
            {content}
          </a>
        )}
      />
    </>
  );
}
