import { createFileRoute, Link } from "@tanstack/react-router";

import { Callout, type ClientNamespace, useMessages, z } from "~/import.js";

const MESSAGES = ["auth"] as const satisfies readonly ClientNamespace[];

// Better Auth appends `?error=…` on failure and nothing on success, which is why the
// *absence* of the parameter is what this page reads as verified.
const Search = z.object({ error: z.string().optional() });

export const Route = createFileRoute("/(shell)/verify-email")({
  validateSearch: Search,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { t } = useMessages("auth");
  const { error } = Route.useSearch();

  // The token is already spent by the time this renders, which is why the page holds no
  // client and makes no request.
  return (
    <main>
      {error ? (
        <Callout tone="danger">{t("auth.verifyEmailFailed")}</Callout>
      ) : (
        <Callout tone="success">{t("auth.verifyEmailDone")}</Callout>
      )}
      {
        // `autoSignInAfterVerification` is off, so verification issues no session and
        // this link is the whole next step.
      }
      <Link to="/sign-in">{t("auth.signIn")}</Link>
    </main>
  );
}
