import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  type DocumentHitDto,
  DocumentMutations,
  EmptyState,
  Field,
  type FormEvent,
  Input,
  useApiClient,
  useState,
} from "../import.js";

// A mutation rather than a query, because the procedure is one: a search records an
// activity row, so it is not a `GET` and has no cache entry to key.
export function DocumentSearch() {
  const { t } = useMessages("document");
  const describe = useErrorMessage();
  const client = useApiClient();
  const search = DocumentMutations.useSearch(client);

  const [query, setQuery] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    search.mutate({ query, limit: 10 });
  };

  const hits: readonly DocumentHitDto[] = search.data?.hits ?? [];

  return (
    <section>
      <h2>{t("document.search.title")}</h2>

      <form onSubmit={submit} noValidate>
        <Field label={t("document.search.query")} htmlFor="document-query">
          <Input
            id="document-query"
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" disabled={search.isPending || query.trim() === ""}>
          {t("document.search.submit")}
        </Button>
      </form>

      {search.isError ? <Callout tone="danger">{describe(search.error)?.message}</Callout> : null}

      {
        // Only after a search has actually run: an empty state before the first submit
        // reads as "the corpus is empty", which is a different claim.
      }
      {search.isSuccess && hits.length === 0 ? (
        <EmptyState title={t("document.search.empty")} />
      ) : null}

      <ul className="ui-list">
        {hits.map((hit) => (
          <li key={hit.id}>
            <p>{hit.content}</p>
            <small>
              {t("document.search.source", { sourceId: hit.sourceId })}
              {" · "}
              {t("document.search.score", { score: hit.score.toFixed(2) })}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
