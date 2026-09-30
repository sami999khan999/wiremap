import { useMessages } from "../i18n/index.js";
import {
  CommandDialog,
  type CommandGroup,
  type DocNavNodeDto,
  type LinkAttributes,
  type ReactNode,
  SearchTrigger,
  useEffect,
  useHotkey,
  useMemo,
  useRef,
  useState,
} from "../import.js";
import { DocNavTree } from "./doc-nav-tree.js";

export interface DocSearchHit {
  readonly id: string;
  readonly title: string;
  readonly excerpt?: string;
  readonly href: string;
}

export type RenderDocLink = (
  href: string,
  content: ReactNode,
  attributes: LinkAttributes,
) => ReactNode;

export interface DocSearchPanelProps {
  readonly nav: readonly DocNavNodeDto[];
  // The space's root, which every page href in `nav` is under.
  readonly base: string;
  readonly renderLink: RenderDocLink;
  // The full-text half, when the shell has one. Titles are matched here without a
  // round trip, so the palette answers on the first keystroke either way.
  readonly search?: (query: string) => Promise<readonly DocSearchHit[]>;
}

// Long enough that a word typed at speed is one request, short enough to feel live.
const DEBOUNCE_MS = 200;
const TITLE_HITS = 8;

// The Ctrl K palette: titles from the tree already on screen, the text from the server.
export function DocSearchPanel({ nav, base, renderLink, search }: DocSearchPanelProps) {
  const { t } = useMessages("doc");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly DocSearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useHotkey("k", () => setOpen(true), { mod: true });

  const pages = useMemo(() => DocNavTree.pages(nav), [nav]);

  // Through a ref, like `useHotkey`'s handler: a shell that passes a new closure on every
  // render would otherwise search again on every render.
  const latest = useRef(search);
  useEffect(() => {
    latest.current = search;
  });
  const searchable = search !== undefined;

  useEffect(() => {
    const trimmed = query.trim();
    const run = latest.current;
    if (!searchable || !run || trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    // A later keystroke wins: the earlier answer is dropped rather than painted over it.
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      run(trimmed)
        .then((found) => current && setHits(found))
        .catch(() => current && setHits([]))
        .finally(() => current && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, searchable]);

  const groups = useMemo((): CommandGroup[] => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const titles = pages
      .filter(({ node }) => node.title.toLowerCase().includes(needle))
      .slice(0, TITLE_HITS)
      .map(({ node, trail }) => ({
        id: node.id,
        title: node.title,
        href: `${base}/${node.path ?? ""}`,
        ...(trail.length > 0 ? { excerpt: trail.join(" › ") } : {}),
      }));

    const seen = new Set(titles.map((item) => item.href));
    const text = hits.filter((hit) => !seen.has(hit.href));

    return [
      { key: "pages", label: t("doc.search.pages"), items: titles },
      { key: "sections", label: t("doc.search.sections"), items: text },
    ].filter((group) => group.items.length > 0);
  }, [query, pages, base, hits, t]);

  return (
    <>
      <SearchTrigger
        label={t("doc.search.placeholder")}
        shortcut={t("doc.search.shortcut")}
        onClick={() => setOpen(true)}
      />
      <CommandDialog
        label={t("doc.search.label")}
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        placeholder={t("doc.search.placeholder")}
        emptyLabel={t("doc.search.empty")}
        loadingLabel={t("doc.search.loading")}
        loading={loading}
        groups={groups}
        renderLink={(item, content, attributes) => renderLink(item.href, content, attributes)}
      />
    </>
  );
}
