import { useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import { Button, Callout, type OrganizationClient, OrganizationMutations } from "../import.js";

// What the landing page knows before anyone is signed in. The same three fields the
// server function returns from `InvitationClaimer.preview`.
export interface InvitationPreview {
  readonly organizationName: string;
  readonly email: string;
  readonly expired: boolean;
}

export interface InvitationAcceptProps {
  readonly preview: InvitationPreview | null;
  readonly token: string;
  readonly organization: OrganizationClient;
  readonly onAccepted: () => void;
  // Callbacks rather than hrefs, because `feature` may not import routing: only the app
  // knows how to spell the redirect back here.
  readonly onSignIn: () => void;
  readonly onSignUp: () => void;
}

// Four states in order, because each earlier one makes the later question moot. The
// email comparison is a courtesy: the server compares the *verified* address.
export function InvitationAccept({
  preview,
  token,
  organization,
  onAccepted,
  onSignIn,
  onSignUp,
}: InvitationAcceptProps) {
  const { t } = useMessages("organization");
  // Renders the code the server sent rather than one generic sentence: a 403 and a
  // 409 are different things to be told.
  const describe = useErrorMessage();
  const { user } = useSession();
  const accept = OrganizationMutations.useAcceptInvitation(organization, onAccepted);

  if (!preview) return <Callout tone="danger">{t("organization.invitation.missing")}</Callout>;

  const params = { organization: preview.organizationName, email: preview.email };

  if (preview.expired) {
    return <Callout tone="warning">{t("organization.invitation.expired", params)}</Callout>;
  }

  if (!user) {
    return (
      <>
        <p>{t("organization.invitation.intro", params)}</p>
        <Button onClick={onSignUp}>{t("organization.invitation.signUp", params)}</Button>{" "}
        <Button variant="secondary" onClick={onSignIn}>
          {t("organization.invitation.signIn", params)}
        </Button>
      </>
    );
  }

  if (user.email.toLowerCase() !== preview.email.toLowerCase()) {
    return (
      <Callout tone="warning">
        {t("organization.invitation.wrongAccount", { ...params, current: user.email })}
      </Callout>
    );
  }

  // The server said no after the page said yes — revoked in between, most likely. Every
  // refusal arrives as NOT_FOUND, and that copy already exists.
  const failure = describe(accept.error);
  const failureCopy =
    failure?.envelope.code === "NOT_FOUND"
      ? t("organization.invitation.missing")
      : failure?.message;

  return (
    <>
      <p>{t("organization.invitation.intro", params)}</p>
      {failure ? <Callout tone="danger">{failureCopy}</Callout> : null}
      <Button disabled={accept.isPending} onClick={() => accept.mutate({ token })}>
        {t("organization.invitation.accept", params)}
      </Button>
    </>
  );
}
