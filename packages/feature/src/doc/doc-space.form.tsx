import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DocMutations,
  type DocSpaceAudience,
  type DocSpaceDto,
  Field,
  type FormEvent,
  Input,
  inputClassName,
  ThemeRegistry,
  useApiClient,
  useState,
} from "../import.js";

export interface DocSpaceFormProps {
  // Absent to create one.
  readonly space?: DocSpaceDto;
  // Whether `public` and `granted` are offered: only the platform organization may use
  // them, and the server refuses them anywhere else whatever this says.
  readonly platform: boolean;
  readonly onSaved?: (space: DocSpaceDto) => void;
  readonly onDeleted?: () => void;
}

const AUDIENCES: readonly DocSpaceAudience[] = ["members", "owner", "public", "granted"];

// Create a space, or edit one. Deleting sits behind a second press rather than a browser
// dialog, which a keyboard reader can reach and a test can drive.
export function DocSpaceForm({ space, platform, onSaved, onDeleted }: DocSpaceFormProps) {
  const { t } = useMessages("doc");
  const describe = useErrorMessage();
  const client = useApiClient();
  const create = DocMutations.useCreateSpace(client);
  const update = DocMutations.useUpdateSpace(client);
  const remove = DocMutations.useDeleteSpace(client);

  const [slug, setSlug] = useState(space?.slug ?? "");
  const [title, setTitle] = useState(space?.title ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [audience, setAudience] = useState<DocSpaceAudience>(space?.audience ?? "members");
  const [theme, setTheme] = useState(space?.theme ?? "");
  const [confirming, setConfirming] = useState(false);

  const id = space?.id ?? "new";
  const pending = create.isPending || update.isPending;
  const failure = create.error ?? update.error ?? remove.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields = {
      slug,
      title,
      description: description.trim() === "" ? null : description,
      icon: space?.icon ?? null,
      audience,
      theme: theme === "" ? null : theme,
    };
    if (space) {
      update.mutate(
        { ...fields, spaceId: space.id, position: space.position },
        { onSuccess: onSaved },
      );
    } else {
      create.mutate(fields, {
        onSuccess: (created) => {
          setSlug("");
          setTitle("");
          setDescription("");
          onSaved?.(created);
        },
      });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="ui-stack">
      <Field label={t("doc.space.title")} htmlFor={`doc-space-title-${id}`}>
        <Input
          id={`doc-space-title-${id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={120}
        />
      </Field>
      <Field
        label={t("doc.space.slug")}
        htmlFor={`doc-space-slug-${id}`}
        hint={t("doc.space.slugHint")}
      >
        <Input
          id={`doc-space-slug-${id}`}
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          required
          maxLength={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
      </Field>
      <Field label={t("doc.space.description")} htmlFor={`doc-space-description-${id}`}>
        <Input
          id={`doc-space-description-${id}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
        />
      </Field>
      <Field
        label={t("doc.space.audience")}
        htmlFor={`doc-space-audience-${id}`}
        {...(platform ? {} : { hint: t("doc.space.audience.hint") })}
      >
        <select
          id={`doc-space-audience-${id}`}
          className={inputClassName()}
          value={audience}
          onChange={(event) => setAudience(event.target.value as DocSpaceAudience)}
        >
          {AUDIENCES.filter(
            (option) =>
              platform || option === "members" || option === "owner" || option === audience,
          ).map((option) => (
            <option key={option} value={option}>
              {t(`doc.space.audience.${option}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("doc.space.theme")} htmlFor={`doc-space-theme-${id}`}>
        <select
          id={`doc-space-theme-${id}`}
          className={inputClassName()}
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
        >
          <option value="">{t("doc.space.themeNone")}</option>
          {ThemeRegistry.all().map((key) => (
            <option key={key} value={key}>
              {ThemeRegistry.meta(key).label}
            </option>
          ))}
        </select>
      </Field>

      {failure ? <Callout tone="danger">{describe(failure)?.message}</Callout> : null}
      {update.isSuccess ? <Callout tone="success">{t("doc.space.saved")}</Callout> : null}

      <div className="ui-reader__actions">
        <Button type="submit" disabled={pending || slug === "" || title.trim() === ""}>
          {space ? t("doc.space.save") : t("doc.space.create")}
        </Button>
        {space ? (
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (!confirming) return setConfirming(true);
              remove.mutate({ spaceId: space.id }, { onSuccess: () => onDeleted?.() });
            }}
          >
            {confirming
              ? t("doc.space.deleteConfirm", { title: space.title })
              : t("doc.space.delete")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
