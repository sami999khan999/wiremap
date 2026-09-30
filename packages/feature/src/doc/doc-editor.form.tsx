import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  buttonClassName,
  Callout,
  DocMutations,
  type DocPageDraftDto,
  Field,
  type FormEvent,
  fieldClassName,
  IconRegistry,
  Input,
  inputClassName,
  Prose,
  type ReactNode,
  StatusBadge,
  Textarea,
  useApiClient,
  useEffect,
  useRef,
  useState,
} from "../import.js";

export interface DocEditorFormProps {
  // The draft as loaded. The shell keys this component by page, so a new page is a new
  // form rather than one whose state has to be reset field by field.
  readonly draft: DocPageDraftDto;
  // The live page, once there is one to open.
  readonly viewLink?: ReactNode;
}

// Long enough that a pause mid-sentence is not a save; short enough that closing the tab
// loses a sentence rather than a paragraph.
const AUTOSAVE_MS = 2_000;

type Tab = "write" | "preview";

// The server's own list and bound, restated so a wrong file never costs a round trip.
const IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// One page's draft and its two writes. Each names the version it read, so of two authors
// the second is told rather than silently overwriting the first.
export function DocEditorForm({ draft, viewLink }: DocEditorFormProps) {
  const { t } = useMessages("doc");
  const describe = useErrorMessage();
  const client = useApiClient();
  const save = DocMutations.useSavePage(client);
  const publish = DocMutations.usePublishPage(client);
  const preview = DocMutations.usePreview(client);
  const upload = DocMutations.useUploadImage(client);
  const [imageError, setImageError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(draft.title);
  const [slug, setSlug] = useState(draft.slug);
  const [description, setDescription] = useState(draft.description ?? "");
  const [icon, setIcon] = useState(draft.icon ?? "");
  const [markdown, setMarkdown] = useState(draft.markdown);
  const [url, setUrl] = useState(draft.url ?? "");
  const [version, setVersion] = useState(draft.draftVersion);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("write");
  const [status, setStatus] = useState(draft.status);

  const isPage = draft.kind === "page";

  // Checked here too, so a wrong file is refused before a URL is signed for it.
  const insertImage = (file: File) => {
    setImageError(null);
    if (!IMAGE_TYPES.includes(file.type)) return setImageError(t("doc.editor.imageType"));
    if (file.size > IMAGE_MAX_BYTES) return setImageError(t("doc.editor.imageTooLarge"));

    upload.mutate(
      { spaceId: draft.spaceId, file },
      {
        onSuccess: (url) => {
          const alt = file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "");
          const at = textarea.current?.selectionStart ?? null;
          // Functional: the upload took a while, and the author kept typing through it.
          setMarkdown((text) => {
            const cut = at ?? text.length;
            return `${text.slice(0, cut)}![${alt}](${url})${text.slice(cut)}`;
          });
          setDirty(true);
        },
      },
    );
  };
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setDirty(true);
    };

  const input = () => ({
    pageId: draft.id,
    draftVersion: version,
    slug,
    title,
    description: description.trim() === "" ? null : description,
    icon: icon === "" ? null : icon,
    markdown,
    url: draft.kind === "link" ? url : null,
  });

  const persist = (then?: (saved: DocPageDraftDto) => void) => {
    save.mutate(input(), {
      onSuccess: (saved) => {
        setVersion(saved.draftVersion);
        setStatus(saved.status);
        setDirty(false);
        then?.(saved);
      },
    });
  };

  // Held in a ref so the timer below always saves the latest text, not the text of the
  // render that armed it.
  const latest = useRef(persist);
  latest.current = persist;

  useEffect(() => {
    if (!dirty || save.isPending || save.isError) return;
    const timer = setTimeout(() => latest.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, save.isPending, save.isError, title, slug, description, icon, markdown, url]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    persist();
  };

  // Saves first when there is anything unsaved, so what is published is what is on screen.
  const doPublish = () => {
    const go = (draftVersion: number) =>
      publish.mutate(
        { pageId: draft.id, draftVersion },
        {
          onSuccess: (published) => {
            setVersion(published.draftVersion);
            setStatus(published.status);
          },
        },
      );
    if (dirty) persist((saved) => go(saved.draftVersion));
    else go(version);
  };

  const showPreview = () => {
    setTab("preview");
    preview.mutate({ markdown });
  };

  const failure = save.error ?? publish.error ?? preview.error ?? upload.error;

  return (
    <form onSubmit={submit} noValidate className="ui-stack">
      <div className="ui-reader__actions">
        <StatusBadge
          tone={status === "published" ? "success" : status === "changed" ? "warning" : "neutral"}
        >
          {dirty ? t("doc.editor.unsaved") : t(`doc.page.status.${status}`)}
        </StatusBadge>
        {viewLink}
      </div>

      <Field label={t("doc.page.title")} htmlFor="doc-title">
        <Input
          id="doc-title"
          value={title}
          onChange={(event) => edit(setTitle)(event.target.value)}
          maxLength={160}
          required
        />
      </Field>
      <Field label={t("doc.page.slug")} htmlFor="doc-slug" hint={t("doc.space.slugHint")}>
        <Input
          id="doc-slug"
          value={slug}
          onChange={(event) => edit(setSlug)(event.target.value.toLowerCase())}
          maxLength={60}
          required
        />
      </Field>
      <Field label={t("doc.page.icon")} htmlFor="doc-icon">
        <select
          id="doc-icon"
          className={inputClassName()}
          value={icon}
          onChange={(event) => edit(setIcon)(event.target.value)}
        >
          <option value="">{t("doc.space.iconNone")}</option>
          {IconRegistry.all().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>

      {draft.kind === "link" ? (
        <Field label={t("doc.page.url")} htmlFor="doc-url">
          <Input
            id="doc-url"
            type="url"
            value={url}
            onChange={(event) => edit(setUrl)(event.target.value)}
          />
        </Field>
      ) : null}

      {isPage ? (
        <>
          <Field label={t("doc.page.description")} htmlFor="doc-description">
            <Input
              id="doc-description"
              value={description}
              onChange={(event) => edit(setDescription)(event.target.value)}
              maxLength={300}
            />
          </Field>

          <div className="ui-reader__actions" role="tablist">
            <Button
              variant={tab === "write" ? "secondary" : "ghost"}
              role="tab"
              aria-selected={tab === "write"}
              onClick={() => setTab("write")}
            >
              {t("doc.editor.write")}
            </Button>
            <Button
              variant={tab === "preview" ? "secondary" : "ghost"}
              role="tab"
              aria-selected={tab === "preview"}
              onClick={showPreview}
            >
              {t("doc.editor.preview")}
            </Button>
            <label className={buttonClassName("ghost")}>
              {upload.isPending ? t("doc.editor.imageUploading") : t("doc.editor.image")}
              <input
                type="file"
                accept={IMAGE_TYPES.join(",")}
                hidden
                disabled={upload.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared, so choosing the same file twice still fires a change.
                  event.target.value = "";
                  if (file) insertImage(file);
                }}
              />
            </label>
          </div>
          {imageError ? <Callout tone="warning">{imageError}</Callout> : null}

          {tab === "write" ? (
            <Field
              label={t("doc.page.markdown")}
              htmlFor="doc-markdown"
              hint={t("doc.page.markdownHint")}
            >
              <Textarea
                ref={textarea}
                id="doc-markdown"
                rows={24}
                value={markdown}
                onChange={(event) => edit(setMarkdown)(event.target.value)}
                spellCheck
              />
            </Field>
          ) : preview.data && preview.data.html.length > 0 ? (
            <Prose
              html={preview.data.html}
              copyLabel={t("doc.code.copy")}
              copiedLabel={t("doc.code.copied")}
            />
          ) : (
            <p className={fieldClassName.hint}>{t("doc.editor.previewEmpty")}</p>
          )}
        </>
      ) : (
        <Callout tone="info">{t("doc.editor.structural")}</Callout>
      )}

      {failure ? <Callout tone="danger">{describe(failure)?.message}</Callout> : null}
      {publish.isSuccess ? (
        <Callout tone="success">
          {t("doc.editor.published", { revision: publish.data.revisionNo })}
        </Callout>
      ) : null}

      <div className="ui-reader__actions">
        <Button type="submit" variant="secondary" disabled={save.isPending || !dirty}>
          {save.isPending ? t("doc.editor.saving") : t("doc.editor.save")}
        </Button>
        {isPage ? (
          <Button
            onClick={doPublish}
            disabled={publish.isPending || save.isPending || (status === "published" && !dirty)}
          >
            {t("doc.editor.publish")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
