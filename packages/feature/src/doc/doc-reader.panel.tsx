import { useMessages } from "../i18n/index.js";
import {
  Button,
  DateFormat,
  type DocNavNodeDto,
  type DocReadingDto,
  type DocSpaceDto,
  EmptyState,
  fieldClassName,
  Icon,
  NavTree,
  Popover,
  Prose,
  type ReactNode,
  ReaderLayout,
  readerClassName,
  Sidebar,
  Toc,
  useEffect,
  useMemo,
  useState,
} from "../import.js";
import { type DocAppearance, DocAppearancePanel } from "./doc-appearance.panel.js";
import { DocCopyButton } from "./doc-copy.button.js";
import { DocNavTree } from "./doc-nav-tree.js";
import { type DocSearchHit, DocSearchPanel, type RenderDocLink } from "./doc-search.panel.js";
import { DocSpaceSwitcherButton } from "./doc-space-switcher.button.js";

export interface DocReaderPanelProps {
  readonly reading: DocReadingDto;
  // Every space this reader may open, for the switcher. The current one included.
  readonly spaces: readonly DocSpaceDto[];
  // `/doc` for an organization's own docs, `/docs` for the platform's. The space and the
  // page path are appended to it, so one component serves both trees.
  readonly root: string;
  readonly renderLink: RenderDocLink;
  readonly onSelectSpace: (slug: string) => void;
  readonly appearance: DocAppearance;
  // Above the search field: a way back into the app, or the product's name.
  readonly brand?: ReactNode;
  // Null when the reader may not edit, or for a page an outside tool cannot fetch.
  readonly editHref?: string | null;
  readonly markdownHref?: string | null;
  readonly search?: (query: string) => Promise<readonly DocSearchHit[]>;
  // The space's whole tree. A page read carries it trimmed, so a large space costs every
  // page nothing; this fills in the folded branches once the page is up.
  readonly loadNav?: () => Promise<readonly DocNavNodeDto[]>;
}

// Fetches the full tree once the browser is idle, only when the read was trimmed, and once
// per space version: the same version is the same tree.
function useFullNav(
  nav: readonly DocNavNodeDto[],
  slug: string,
  version: number,
  loadNav: (() => Promise<readonly DocNavNodeDto[]>) | undefined,
): readonly DocNavNodeDto[] | null {
  const [full, setFull] = useState<{ key: string; nav: readonly DocNavNodeDto[] } | null>(null);
  const key = `${slug}@${version}`;
  const folded = useMemo(() => DocNavTree.isFolded(nav), [nav]);

  useEffect(() => {
    if (!loadNav || !folded || full?.key === key) return;
    let live = true;
    const start = () => {
      loadNav()
        .then((tree) => {
          if (live) setFull({ key, nav: tree });
        })
        // A tree that did not arrive leaves the trimmed one, which still reads correctly.
        .catch(() => {});
    };
    // Safari has no idle callback; a short timeout is the same "after the first paint".
    if ("requestIdleCallback" in globalThis) {
      const handle = globalThis.requestIdleCallback(start, { timeout: 2_000 });
      return () => {
        live = false;
        globalThis.cancelIdleCallback(handle);
      };
    }
    const handle = setTimeout(start, 200);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [loadNav, folded, full?.key, key]);

  return full?.key === key ? full.nav : null;
}

// Each opens a new conversation with the prompt filled in; neither needs an account here.
const OPEN_IN = [
  {
    key: "chatgpt",
    href: (prompt: string) => `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`,
  },
  {
    key: "claude",
    href: (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
] as const;

const OPEN_ITEM =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-fg text-sm no-underline transition-colors duration-(--duration-fast) hover:bg-muted [&_svg]:text-fg-muted";

const PAGER =
  "ui-doc-pager__link flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 no-underline transition-colors duration-(--duration-fast) hover:bg-muted";

// The whole reading screen: navigation, the page, its outline. The shell supplies links
// and data; nothing here fetches.
export function DocReaderPanel({
  reading,
  spaces,
  root,
  renderLink,
  onSelectSpace,
  appearance,
  brand,
  editHref = null,
  markdownHref = null,
  search,
  loadNav,
}: DocReaderPanelProps) {
  const { t } = useMessages("doc");
  const { space, page } = reading;
  const base = `${root}/${space.slug}`;
  const full = useFullNav(space.nav, space.slug, space.version, loadNav);
  const nav = full ?? space.nav;
  const nodes = useMemo(() => DocNavTree.toNodes(nav, base), [nav, base]);
  // Reading order, from the tree this reader may see: the pager and the trail follow it.
  const order = useMemo(() => DocNavTree.pages(nav), [nav]);
  const [open, setOpen] = useState(false);
  // The tools fetch the source themselves, so they need it absolute; the origin is only
  // known in the browser, and reading it after mount keeps the server's HTML the same.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(globalThis.location.origin), []);
  const source = markdownHref && origin ? new URL(markdownHref, origin).toString() : null;

  // A drawer left open over the page just navigated to would hide the page asked for.
  const pageId = page?.id;
  useEffect(() => {
    if (pageId !== undefined) setOpen(false);
  }, [pageId]);

  const sidebar = (
    <Sidebar
      label={t("doc.nav.label")}
      open={open}
      onOpenChange={setOpen}
      closeLabel={t("doc.sidebar.close")}
      header={
        <>
          {brand}
          <DocSearchPanel
            nav={nav}
            base={base}
            renderLink={renderLink}
            {...(search ? { search } : {})}
          />
          <DocSpaceSwitcherButton spaces={spaces} current={space.slug} onSelect={onSelectSpace} />
        </>
      }
      footer={
        <>
          {space.repositoryUrl ? (
            <a
              href={space.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t("doc.repository.label")}
              title={t("doc.repository.label")}
              className="ui-doc-repository inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-(--duration-fast) hover:bg-muted hover:text-fg"
            >
              <Icon name="github" size={18} />
            </a>
          ) : null}
          <DocAppearancePanel appearance={appearance} />
        </>
      }
    >
      <NavTree
        label={t("doc.nav.label")}
        nodes={nodes}
        renderLink={(node, content, attributes) =>
          renderLink(node.href ?? base, content, attributes)
        }
        {...(pageId ? { activeId: pageId } : {})}
        expandLabel={t("doc.nav.expand")}
        collapseLabel={t("doc.nav.collapse")}
      />
    </Sidebar>
  );

  const topbar = (
    <>
      <Button variant="ghost" aria-label={t("doc.sidebar.open")} onClick={() => setOpen(true)}>
        <Icon name="menu" size={18} />
      </Button>
      <span>{space.title}</span>
    </>
  );

  if (!page) {
    return (
      <ReaderLayout sidebar={sidebar} topbar={topbar}>
        <EmptyState icon="book" title={space.title} description={t("doc.space.empty")} />
      </ReaderLayout>
    );
  }

  const at = order.findIndex((entry) => entry.node.id === page.id);
  const previous = at > 0 ? order[at - 1] : undefined;
  const next = at >= 0 ? order[at + 1] : undefined;
  const trail = at >= 0 ? (order[at]?.trail ?? []) : [];

  const header = (
    <>
      {trail.length > 0 ? (
        <nav aria-label={t("doc.breadcrumb.label")} className="ui-doc-breadcrumb">
          <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-fg-muted text-sm">
            {trail.map((title, index) => (
              <li key={`${index}-${title}`} className="flex items-center gap-1">
                {index > 0 ? <Icon name="chevron-right" size={12} /> : null}
                <span>{title}</span>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className={readerClassName.title}>{page.title}</h1>
      {page.description ? <p className={readerClassName.description}>{page.description}</p> : null}
      <div className={readerClassName.actions}>
        <DocCopyButton markdown={page.markdown} />
        {markdownHref || editHref ? (
          <Popover
            label={t("doc.open.label")}
            align="start"
            variant="secondary"
            trigger={
              <>
                {t("doc.open.label")}
                <Icon name="chevron-down" size={14} />
              </>
            }
          >
            <ul className="ui-doc-open m-0 flex min-w-52 list-none flex-col gap-0.5 p-0">
              {markdownHref ? (
                <li>
                  <a href={markdownHref} target="_blank" rel="noreferrer" className={OPEN_ITEM}>
                    <Icon name="file" size={16} />
                    {t("doc.open.markdown")}
                  </a>
                </li>
              ) : null}
              {source
                ? OPEN_IN.map((tool) => (
                    <li key={tool.key}>
                      <a
                        href={tool.href(t("doc.open.prompt", { url: source }))}
                        target="_blank"
                        rel="noreferrer"
                        className={OPEN_ITEM}
                      >
                        <Icon name="chat" size={16} />
                        <span className="flex-1">{t(`doc.open.${tool.key}`)}</span>
                        <Icon name="external" size={14} />
                      </a>
                    </li>
                  ))
                : null}
              {editHref ? (
                <li>
                  {renderLink(
                    editHref,
                    <>
                      <Icon name="edit" size={16} />
                      {t("doc.open.edit")}
                    </>,
                    { className: OPEN_ITEM },
                  )}
                </li>
              ) : null}
            </ul>
          </Popover>
        ) : null}
      </div>
    </>
  );

  return (
    <ReaderLayout
      sidebar={sidebar}
      topbar={topbar}
      header={header}
      {...(page.toc.length > 0
        ? { aside: <Toc title={t("doc.toc.title")} items={page.toc} /> }
        : {})}
    >
      <Prose html={page.html} copyLabel={t("doc.code.copy")} copiedLabel={t("doc.code.copied")} />
      <p className={`${fieldClassName.hint} mt-10`}>
        {t("doc.updated", { date: DateFormat.day(page.publishedAt) })}
      </p>
      {previous || next ? (
        <nav
          aria-label={t("doc.pager.label")}
          className="ui-doc-pager mt-10 grid grid-cols-1 gap-3 border-border border-t pt-6 sm:grid-cols-2"
        >
          {previous ? (
            renderLink(
              `${base}/${previous.node.path ?? ""}`,
              <>
                <span className="text-fg-muted text-xs">{t("doc.pager.previous")}</span>
                <span className="font-medium text-fg">{previous.node.title}</span>
              </>,
              { className: PAGER },
            )
          ) : (
            <span />
          )}
          {next
            ? renderLink(
                `${base}/${next.node.path ?? ""}`,
                <>
                  <span className="text-fg-muted text-xs">{t("doc.pager.next")}</span>
                  <span className="font-medium text-fg">{next.node.title}</span>
                </>,
                { className: `${PAGER} sm:items-end sm:text-right` },
              )
            : null}
        </nav>
      ) : null}
    </ReaderLayout>
  );
}
