import { Link } from "@tanstack/react-router";
import {
  Button,
  buttonClassName,
  Callout,
  EmptyState,
  Icon,
  useErrorMessage,
  useMessages,
} from "~/import.js";

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

// A route that does not exist is `NOT_FOUND`. It renders a centered card with the brand,
// a 404 badge, the catalog's sentence, and recovery actions.
export function NotFound() {
  const { t } = useMessages("common");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
      <Link
        to="/"
        className="flex items-center gap-2 font-mono text-base font-semibold text-fg no-underline"
      >
        <Icon name="graph" size={20} className="text-primary" />
        {t("brand.name")}
      </Link>
      <div className="flex w-full flex-col items-center gap-5 rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted">
          <Icon name="route" size={28} className="text-primary" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs font-semibold tracking-wider text-primary">404</span>
          <h1 className="m-0 font-semibold text-fg text-lg">{t("error.notFound")}</h1>
          <p className="m-0 max-w-[36ch] text-fg-muted text-sm">
            This route does not exist or may have been moved in the graph.
          </p>
        </div>
        <div className="mt-2 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => window.history.back()}>
            Go back
          </Button>
          <Link to="/" className={buttonClassName("primary")}>
            Return home
          </Link>
        </div>
      </div>
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
