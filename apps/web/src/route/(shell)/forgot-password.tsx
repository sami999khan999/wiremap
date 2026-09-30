import { createFileRoute, Link } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  ForgotPasswordForm,
  useMemo,
  useMessages,
} from "~/import.js";

const MESSAGES = ["auth"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(shell)/forgot-password")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useMessages("auth");
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);

  return (
    <main>
      {
        // Where Better Auth redirects once it has spent the emailed token, carrying a
        // fresh one on the query string.
      }
      <ForgotPasswordForm auth={auth} resetUrl="/reset-password" />
      <Link to="/sign-in">{t("auth.signIn")}</Link>
    </main>
  );
}
