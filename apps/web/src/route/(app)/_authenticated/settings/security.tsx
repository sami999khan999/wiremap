import { createFileRoute } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AccountClient,
  AuthClient,
  type ClientNamespace,
  LinkedAccountList,
  TwoFactorPanel,
  TwoFactorSetup,
  useMemo,
  useMessages,
  useState,
} from "~/import.js";

const MESSAGES = ["account"] as const satisfies readonly ClientNamespace[];

// No `requirePermission`: managing your own credentials is not a capability anyone can
// be denied, so the layout's `requireSession()` is the whole gate.
export const Route = createFileRoute("/(app)/_authenticated/settings/security")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: SecurityPage,
});

function SecurityPage() {
  const { t } = useMessages("account");
  // The heading is the same word the shell's settings link uses, and `nav` is loaded by
  // the layout above this route rather than declared again here.
  const { t: nav } = useMessages("nav");
  const { googleEnabled, session } = Route.useRouteContext();

  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  // One Better Auth instance behind both, so a fetch here and a `getSession()` there
  // share the same cookie handling and the same plugin set.
  const account = useMemo(() => new AccountClient(auth), [auth]);

  // From the store rather than a query: the root already resolved it during SSR.
  const [enrolled, setEnrolled] = useState(session.user?.twoFactorEnabled === true);

  return (
    <main>
      <h1>{nav("nav.security")}</h1>

      <section>
        <h2>{t("account.twoFactorTitle")}</h2>
        {enrolled ? (
          <TwoFactorPanel account={account} />
        ) : (
          <TwoFactorSetup account={account} onEnabled={() => setEnrolled(true)} />
        )}
      </section>

      <section>
        <h2>{t("account.linkedAccounts")}</h2>
        <LinkedAccountList
          account={account}
          googleEnabled={googleEnabled}
          // Back to this page, so a round trip through Google returns where it started.
          linkCallbackUrl="/settings/security"
        />
      </section>
    </main>
  );
}
