import { useMessages } from "../i18n/index.js";
import { type AuthClient, Button, Callout, SessionMutations } from "../import.js";

export interface SocialSignInProps {
  readonly auth: AuthClient;
  // Resolved server-side and riding the session snapshot, because `Env` is server-only
  // and a button leading to an unconfigured provider is worse than no button.
  readonly enabled: boolean;
  readonly callbackUrl: string;
  readonly errorCallbackUrl: string;
}

export function SocialSignIn({ auth, enabled, callbackUrl, errorCallbackUrl }: SocialSignInProps) {
  const { t } = useMessages("auth");
  const google = SessionMutations.useSignInWithGoogle(auth);

  if (!enabled) return null;

  return (
    <>
      {
        // Reached only when the redirect never happened, which is a misconfigured client
        // id rather than anything the visitor did.
      }
      {google.isError ? <Callout tone="danger">{t("auth.socialFailed")}</Callout> : null}

      <Button
        variant="secondary"
        disabled={google.isPending}
        onClick={() =>
          google.mutate({ callbackURL: callbackUrl, errorCallbackURL: errorCallbackUrl })
        }
      >
        {t("auth.continueWithGoogle")}
      </Button>

      <p className="ui-field__hint">{t("auth.orDivider")}</p>
    </>
  );
}
