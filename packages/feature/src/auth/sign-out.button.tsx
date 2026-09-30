import { useMessages } from "../i18n/index.js";
import { type AuthClient, Button, Callout, SessionMutations } from "../import.js";

export interface SignOutButtonProps {
  readonly auth: AuthClient;
  // Runs after the cookie is gone. The call site clears the cache and navigates, because
  // that is a lifecycle decision this component cannot make.
  readonly onSignedOut: () => void;
}

export function SignOutButton({ auth, onSignedOut }: SignOutButtonProps) {
  const { t } = useMessages("nav");
  const signOut = SessionMutations.useSignOut(auth, onSignedOut);

  return (
    <>
      <Button variant="ghost" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        {t("nav.signOut")}
      </Button>

      {
        // A refused sign-out leaves the session live, so `onSignedOut` does not run and
        // the shell would otherwise say nothing at all.
      }
      {signOut.isError ? <Callout tone="danger">{t("nav.signOutFailed")}</Callout> : null}
    </>
  );
}
