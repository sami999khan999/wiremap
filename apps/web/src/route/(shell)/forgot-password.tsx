import { createFileRoute, Link } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  ForgotPasswordForm,
  useMemo,
  useMessages,
} from "~/import.js";
import { AuthFrame } from "~/route/-auth-frame.js";

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
    <AuthFrame
      title={t("auth.resetRequest")}
      subtitle="Enter your email to receive a password reset link"
      badge="RESET"
    >
      <ForgotPasswordForm auth={auth} resetUrl="/reset-password" />
      <Link to="/sign-in">{t("auth.signIn")}</Link>
    </AuthFrame>
  );
}
