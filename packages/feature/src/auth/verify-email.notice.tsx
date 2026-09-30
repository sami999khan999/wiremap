import { useMessages } from "../i18n/index.js";
import { type AuthClient, Button, Callout, SessionMutations } from "../import.js";

export interface VerifyEmailNoticeProps {
  readonly auth: AuthClient;
  // The address the link went to. Rendered back, because "check your inbox" is useless
  // to someone who mistyped their address and needs to see that they did.
  readonly email: string;
  readonly verifyCallbackUrl: string;
}

// What a completed sign-up lands on. Not a route of its own — the sign-up page swaps to
// it — because the address it needs only exists in the form that just submitted.
export function VerifyEmailNotice({ auth, email, verifyCallbackUrl }: VerifyEmailNoticeProps) {
  const { t } = useMessages("auth");
  const resend = SessionMutations.useResendVerification(auth);

  return (
    <>
      <Callout tone="success" title={t("auth.verifyEmail")}>
        {t("auth.verifyEmailSent", { email })}
      </Callout>

      {
        // Resolves either way: reachable with any address, so a distinguishable failure
        // is an enumeration oracle.
      }
      {resend.isSuccess ? <Callout tone="info">{t("auth.verifyEmailResent")}</Callout> : null}

      <Button
        variant="secondary"
        disabled={resend.isPending}
        onClick={() => resend.mutate({ email, callbackURL: verifyCallbackUrl })}
      >
        {t("auth.verifyEmailResend")}
      </Button>
    </>
  );
}
