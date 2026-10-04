import { createFileRoute } from "@tanstack/react-router";
import {
  ApiKeyList,
  ApiKeyQueries,
  Can,
  type ClientNamespace,
  CreateApiKeyForm,
  Page,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

// One local const referenced twice, as in `/settings/roles`: `staticData` is what a
// prefetcher can read without executing anything, and the loader resolves it.
const MESSAGES = ["apikey"] as const satisfies readonly ClientNamespace[];

// The same page and limit `ApiKeyList` asks for, so its `useAppQuery` reads the cache
// the loader filled rather than issuing a second request after hydration.
const PAGE = { limit: 25, offset: 0 } as const;

// Behind `apikey.read` — the same key the procedure is gated on and the use-case
// asserts. See docs/reference/enforcement-surfaces.md.
export const Route = createFileRoute("/(app)/_authenticated/settings/api-keys")({
  beforeLoad: RouteGuard.requirePermission("apikey.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(ApiKeyQueries.list(context.api, PAGE)),
    ]),
  component: ApiKeys,
});

function ApiKeys() {
  const { t } = useMessages("apikey");
  const capabilities = useCapabilities();

  return (
    <Page width="embedded">
      <h1>{t("apikey.title")}</h1>
      <p>{t("apikey.subtitle")}</p>
      <ApiKeyList />
      {
        // Issuing is a different key from reading, so the form is gated separately: a
        // role that audits keys need not be one that can mint them.
      }
      <Can permission="apikey.manage" capabilities={capabilities}>
        <CreateApiKeyForm />
      </Can>
    </Page>
  );
}
