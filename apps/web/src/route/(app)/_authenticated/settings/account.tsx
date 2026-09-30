import { createFileRoute } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AccountClient,
  ActiveSessionList,
  AuthClient,
  ChangeEmailForm,
  ChangePasswordForm,
  type ClientNamespace,
  ProfileForm,
  useMemo,
  useMessages,
} from "~/import.js";

const MESSAGES = ["account"] as const satisfies readonly ClientNamespace[];

// Session-gated only, like `/settings/security` and for the same reason.
export const Route = createFileRoute("/(app)/_authenticated/settings/account")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: AccountPage,
});

function AccountPage() {
  const { t } = useMessages("account");
  // The heading is the same word the shell's settings link uses, and `nav` is loaded by
  // the layout above this route rather than declared again here.
  const { t: nav } = useMessages("nav");
  const { user } = Route.useRouteContext();

  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  const account = useMemo(() => new AccountClient(auth), [auth]);

  // Unreachable: the layout already ran `requireSession()`. Narrowing rather than `!`,
  // which would crash the day someone moves this file out from under the guard.
  if (!user) return null;

  return (
    <main>
      <h1>{nav("nav.account")}</h1>

      <section>
        <h2>{t("account.profile")}</h2>
        <ProfileForm account={account} currentName={user.name} />
      </section>

      <section>
        <h2>{t("account.changePassword")}</h2>
        <ChangePasswordForm account={account} />
      </section>

      <section>
        <h2>{t("account.changeEmail")}</h2>
        {
          // The server sends the confirmation to the *current* address. This is only
          // where the link lands once the token is spent.
        }
        <ChangeEmailForm account={account} callbackUrl="/settings/account" />
      </section>

      <section>
        <h2>{t("account.sessions")}</h2>
        <ActiveSessionList account={account} />
      </section>
    </main>
  );
}
