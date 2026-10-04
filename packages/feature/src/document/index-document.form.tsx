import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DocumentMutations,
  Field,
  type FormEvent,
  Textarea,
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
    <section>
      <h2>{t("document.index.title")}</h2>
      <form onSubmit={submit} noValidate>
        <Field
          label={t("document.index.text")}
          htmlFor="document-text"
          hint={t("document.index.hint")}
        >
          <Textarea
            id="document-text"
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
    </section>
  );
}
