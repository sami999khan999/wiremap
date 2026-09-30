import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DocumentMutations,
  Field,
  type FormEvent,
  useApiClient,
  useState,
} from "../import.js";

export function IndexDocumentForm() {
  const { t } = useMessages("document");
  const describe = useErrorMessage();
  const client = useApiClient();
  const index = DocumentMutations.useIndex(client);

  const [text, setText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    index.mutate({ text, goalId: null, sourceType: "document" }, { onSuccess: () => setText("") });
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>{t("document.index.title")}</h2>

      <Field
        label={t("document.index.text")}
        htmlFor="document-text"
        hint={t("document.index.hint")}
      >
        {
          // A textarea, not `Input`: the design system has no multiline control yet, and
          // a single-line field for a document is worse than an unstyled one.
        }
        <textarea
          id="document-text"
          className="ui-input"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          required
        />
      </Field>

      {index.isSuccess ? (
        <Callout tone="success">
          {t("document.index.queued", { documentId: index.data.documentId })}
        </Callout>
      ) : null}
      {index.isError ? <Callout tone="danger">{describe(index.error)?.message}</Callout> : null}

      <Button type="submit" disabled={index.isPending || text.trim() === ""}>
        {t("document.index.submit")}
      </Button>
    </form>
  );
}
