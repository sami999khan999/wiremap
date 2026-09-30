import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type BadgeTone,
  Button,
  Callout,
  DocMutations,
  type DocPageId,
  type DocPageKind,
  type DocPageNodeDto,
  type DocPageStatus,
  DocQueries,
  type DocSpaceId,
  EmptyState,
  Field,
  type FormEvent,
  Icon,
  Input,
  type ReactNode,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";
import { DocNavTree } from "./doc-nav-tree.js";
import type { RenderDocLink } from "./doc-search.panel.js";

export interface DocPageTreeListProps {
  readonly spaceId: DocSpaceId;
  readonly activePageId?: DocPageId;
  // Where a page opens in the editor.
  readonly editHref: (pageId: DocPageId) => string;
  readonly renderLink: RenderDocLink;
}

const TONE: Readonly<Record<DocPageStatus, BadgeTone>> = {
  draft: "neutral",
  published: "success",
  changed: "warning",
};

const KINDS: readonly DocPageKind[] = ["page", "section", "link"];

type Children = ReadonlyMap<DocPageId | null, readonly DocPageNodeDto[]>;

// The editor's tree: every page, drafts included, with the moves that arrange it. A move
// is one request naming the new parent and index; the server renumbers the siblings.
export function DocPageTreeList({
  spaceId,
  activePageId,
  editHref,
  renderLink,
}: DocPageTreeListProps) {
  const { t } = useMessages("doc");
  const describe = useErrorMessage();
  const client = useApiClient();
  const tree = useAppQuery(DocQueries.tree(client, spaceId));
  const create = DocMutations.useCreatePage(client);
  const move = DocMutations.useMovePage(client);
  const remove = DocMutations.useDeletePage(client);

  const [kind, setKind] = useState<DocPageKind>("page");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [parentId, setParentId] = useState<DocPageId | null>(null);
  const [confirming, setConfirming] = useState<DocPageId | null>(null);

  const items: readonly DocPageNodeDto[] = tree.data?.items ?? [];
  const children = useMemo((): Children => {
    const grouped = new Map<DocPageId | null, DocPageNodeDto[]>();
    for (const item of items) {
      const bucket = grouped.get(item.parentId);
      if (bucket) bucket.push(item);
      else grouped.set(item.parentId, [item]);
    }
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    }
    return grouped;
  }, [items]);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        spaceId,
        parentId,
        kind,
        title,
        // A title in a script `slugify` drops, Bengali say, still needs an address.
        slug: DocNavTree.slugify(title) || `${kind}-${Date.now().toString(36)}`,
        icon: null,
        url: kind === "link" ? url : null,
      },
      {
        onSuccess: () => {
          setTitle("");
          setUrl("");
        },
      },
    );
  };

  const shift = (node: DocPageNodeDto, delta: -1 | 1) => {
    const siblings = children.get(node.parentId) ?? [];
    const index = siblings.findIndex((sibling) => sibling.id === node.id);
    move.mutate({ pageId: node.id, parentId: node.parentId, position: Math.max(0, index + delta) });
  };

  const indent = (node: DocPageNodeDto) => {
    const siblings = children.get(node.parentId) ?? [];
    const above = siblings[siblings.findIndex((sibling) => sibling.id === node.id) - 1];
    if (!above || above.kind === "link") return;
    move.mutate({
      pageId: node.id,
      parentId: above.id,
      position: children.get(above.id)?.length ?? 0,
    });
  };

  const outdent = (node: DocPageNodeDto) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent) return;
    const siblings = children.get(parent.parentId) ?? [];
    const index = siblings.findIndex((sibling) => sibling.id === parent.id);
    move.mutate({ pageId: node.id, parentId: parent.parentId, position: index + 1 });
  };

  const branch = (parent: DocPageId | null): ReactNode => {
    const list = children.get(parent) ?? [];
    if (list.length === 0) return null;
    return (
      <ul className="ui-stack">
        {list.map((node) => (
          <li key={node.id}>
            <div className="ui-reader__actions">
              {renderLink(
                editHref(node.id),
                <>
                  <strong>{node.title}</strong>{" "}
                  <StatusBadge tone={node.kind === "page" ? TONE[node.status] : "neutral"}>
                    {node.kind === "page"
                      ? t(`doc.page.status.${node.status}`)
                      : t(`doc.page.kind.${node.kind}`)}
                  </StatusBadge>
                </>,
                node.id === activePageId
                  ? { className: "", "aria-current": "page" }
                  : { className: "" },
              )}
              <Button
                variant="ghost"
                aria-label={t("doc.tree.moveUp", { title: node.title })}
                onClick={() => shift(node, -1)}
              >
                <span aria-hidden="true">↑</span>
              </Button>
              <Button
                variant="ghost"
                aria-label={t("doc.tree.moveDown", { title: node.title })}
                onClick={() => shift(node, 1)}
              >
                <span aria-hidden="true">↓</span>
              </Button>
              <Button
                variant="ghost"
                aria-label={t("doc.tree.indent", { title: node.title })}
                onClick={() => indent(node)}
              >
                <span aria-hidden="true">→</span>
              </Button>
              <Button
                variant="ghost"
                aria-label={t("doc.tree.outdent", { title: node.title })}
                onClick={() => outdent(node)}
              >
                <span aria-hidden="true">←</span>
              </Button>
              <Button
                variant={confirming === node.id ? "danger" : "ghost"}
                aria-label={t("doc.tree.delete", { title: node.title })}
                onClick={() => {
                  if (confirming !== node.id) return setConfirming(node.id);
                  remove.mutate({ pageId: node.id }, { onSuccess: () => setConfirming(null) });
                }}
              >
                {confirming === node.id ? (
                  t("doc.tree.deleteConfirm", { title: node.title })
                ) : (
                  <Icon name="x" size={14} />
                )}
              </Button>
            </div>
            {branch(node.id)}
          </li>
        ))}
      </ul>
    );
  };

  const failure = create.error ?? move.error ?? remove.error;

  return (
    <div className="ui-stack">
      {items.length === 0 && !tree.isPending ? (
        <EmptyState icon="file" title={t("doc.tree.empty")} />
      ) : null}
      {branch(null)}
      {failure ? <Callout tone="danger">{describe(failure)?.message}</Callout> : null}

      <form onSubmit={submit} noValidate className="ui-stack">
        <Field label={t("doc.page.kind")} htmlFor="doc-new-kind">
          <select
            id="doc-new-kind"
            className="ui-input"
            value={kind}
            onChange={(event) => setKind(event.target.value as DocPageKind)}
          >
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {t(`doc.page.kind.${option}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("doc.page.title")} htmlFor="doc-new-title">
          <Input
            id="doc-new-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
          />
        </Field>
        {kind === "link" ? (
          <Field label={t("doc.page.url")} htmlFor="doc-new-url">
            <Input
              id="doc-new-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label={t("doc.tree.add")} htmlFor="doc-new-parent">
          <select
            id="doc-new-parent"
            className="ui-input"
            value={parentId ?? ""}
            onChange={(event) =>
              setParentId(event.target.value === "" ? null : (event.target.value as DocPageId))
            }
          >
            <option value="">—</option>
            {items
              .filter((item) => item.kind !== "link")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {t("doc.tree.addUnder", { title: item.title })}
                </option>
              ))}
          </select>
        </Field>
        <Button
          type="submit"
          disabled={create.isPending || title.trim() === "" || (kind === "link" && url === "")}
        >
          {t("doc.tree.add")}
        </Button>
      </form>
    </div>
  );
}
