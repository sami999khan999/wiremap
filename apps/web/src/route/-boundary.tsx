import { Button, Callout, EmptyState, useErrorMessage, useMessages } from "~/import.js";

// Hyphen-prefixed: not a route. Both components render inside `RootDocument`, so the
// providers `useErrorMessage` needs are already above them.

// What a thrown error renders as. The copy comes from the code the server sent, so a
// FORBIDDEN reads as a permission problem rather than as a generic failure.
export function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useMessages("common");
  const describe = useErrorMessage();
  const failure = describe(error);

  return (
    <main>
      <EmptyState
        icon="check"
        title={failure?.message ?? t("state.error")}
        action={<Button onClick={reset}>{t("action.retry")}</Button>}
      />
      {
        // A validation failure carries one sentence per field, and losing them here
        // is how a form error becomes "something went wrong".
        failure?.fields.map((sentence) => (
          <Callout key={sentence} tone="danger">
            {sentence}
          </Callout>
        ))
      }
    </main>
  );
}

// A route that does not exist is `NOT_FOUND`, and it gets the catalog's sentence for
// that code rather than a second phrasing invented here.
export function NotFound() {
  const { t } = useMessages("common");

  return (
    <main>
      <EmptyState icon="check" title={t("error.notFound")} />
    </main>
  );
}

// What a subtree renders while its loaders run. On the layout rather than each leaf,
// so a page that forgets one still says it is working.
export function Pending() {
  const { t } = useMessages("common");

  return (
    <main>
      <EmptyState icon="check" title={t("state.loading")} />
    </main>
  );
}
