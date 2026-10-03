import { useMessages } from "../i18n/index.js";
import { type AuthClient, Button, Callout, fieldClassName, SessionMutations } from "../import.js";

export interface SocialSignInProps {
  readonly auth: AuthClient;
  // Resolved server-side and riding the session snapshot, because `Env` is server-only
  // and a button leading to an unconfigured provider is worse than no button.
  readonly enabled: boolean;
  readonly githubEnabled?: boolean;
  readonly callbackUrl: string;
  readonly errorCallbackUrl: string;
}

export function SocialSignIn({
  auth,
  enabled,
  githubEnabled = false,
  callbackUrl,
  errorCallbackUrl,
}: SocialSignInProps) {
  const { t } = useMessages("auth");
  const google = SessionMutations.useSignInWithGoogle(auth);
  const github = SessionMutations.useSignInWithGitHub(auth);

  if (!enabled && !githubEnabled) return null;
  const urls = { callbackURL: callbackUrl, errorCallbackURL: errorCallbackUrl };

  return (
    <>
      {
        // Reached only when the redirect never happened, which is a misconfigured client
        // id rather than anything the visitor did.
      }
      {google.isError || github.isError ? (
        <Callout tone="danger">{t("auth.socialFailed")}</Callout>
      ) : null}

      {githubEnabled ? (
        <Button variant="secondary" disabled={github.isPending} onClick={() => github.mutate(urls)}>
          {t("auth.continueWithGitHub")}
        </Button>
      ) : null}
      {enabled ? (
        <Button variant="secondary" disabled={google.isPending} onClick={() => google.mutate(urls)}>
          {t("auth.continueWithGoogle")}
        </Button>
      ) : null}

      <p className={fieldClassName.hint}>{t("auth.orDivider")}</p>
    </>
  );
}
