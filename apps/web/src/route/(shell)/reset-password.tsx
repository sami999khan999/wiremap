import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  Callout,
  type ClientNamespace,
  ResetPasswordForm,
  useMemo,
  useMessages,
  z,
} from "~/import.js";

const MESSAGES = ["auth"] as const satisfies readonly ClientNamespace[];

// Optional rather than required: arriving without a token is a real case, and it
// deserves a sentence rather than a router error page.
const Search = z.object({ token: z.string().min(1).optional() });

export const Route = createFileRoute("/(shell)/reset-password")({
  validateSearch: Search,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useMessages("auth");
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);

  // No session to invalidate: `revokeSessionsOnPasswordReset` is on, so every session is
  // already gone by the time the mutation resolves.
  const complete = () => void navigate({ to: "/sign-in" });

  return (
    <main>
      <h1>{t("auth.resetTitle")}</h1>
      {token ? (
        <ResetPasswordForm auth={auth} token={token} onSuccess={complete} />
      ) : (
        <>
          <Callout tone="danger">{t("auth.resetFailed")}</Callout>
          <Link to="/forgot-password">{t("auth.resetRequest")}</Link>
        </>
      )}
    </main>
  );
}
