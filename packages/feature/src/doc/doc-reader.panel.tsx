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
  const [open, setOpen] = useState(false);

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
      footer={<DocAppearancePanel appearance={appearance} />}
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

  const header = (
    <>
      <h1 className={readerClassName.title}>{page.title}</h1>
      {page.description ? <p className={readerClassName.description}>{page.description}</p> : null}
      <div className={readerClassName.actions}>
        <DocCopyButton markdown={page.markdown} />
        {markdownHref || editHref ? (
          <Popover
            label={t("doc.open.label")}
            align="start"
            trigger={
              <>
                {t("doc.open.label")}
                <Icon name="chevron-down" size={14} />
              </>
            }
          >
            <ul className="ui-stack flex flex-col gap-3">
              {markdownHref ? (
                <li>
                  <a href={markdownHref} target="_blank" rel="noreferrer">
                    {t("doc.open.markdown")}
                  </a>
                </li>
              ) : null}
              {editHref ? (
                <li>{renderLink(editHref, t("doc.open.edit"), { className: "" })}</li>
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
      <p className={fieldClassName.hint}>
        {t("doc.updated", { date: DateFormat.day(page.publishedAt) })}
      </p>
    </ReaderLayout>
  );
}
