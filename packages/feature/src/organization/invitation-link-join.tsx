import { useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import { Button, Callout, type OrganizationClient, OrganizationMutations } from "../import.js";

// What the join page knows before anyone signs in, from `InvitationLinkClaimer.preview`.
export interface InvitationLinkPreview {
  readonly organizationName: string;
  readonly roleName: string;
  readonly usable: boolean;
}

export interface InvitationLinkJoinProps {
  readonly preview: InvitationLinkPreview | null;
  readonly token: string;
  readonly organization: OrganizationClient;
  readonly onJoined: () => void;
  // Callbacks, because `feature` may not import routing.
  readonly onSignIn: () => void;
  readonly onSignUp: () => void;
}

// Like `InvitationAccept`, without an address to compare: any verified account may join.
export function InvitationLinkJoin({
  preview,
  token,
  organization,
  onJoined,
  onSignIn,
  onSignUp,
}: InvitationLinkJoinProps) {
  const { t } = useMessages("organization");
  const describe = useErrorMessage();
  const { user } = useSession();
  const accept = OrganizationMutations.useAcceptInvitationLink(organization, onJoined);

  if (!preview?.usable) return <Callout tone="danger">{t("organization.join.dead")}</Callout>;

  const params = { organization: preview.organizationName, role: preview.roleName };

  return (
    <>
      <h1 className="m-0 text-xl font-semibold">{t("organization.join.title", params)}</h1>
      <p className="m-0 text-sm text-fg-muted">{t("organization.join.intro", params)}</p>
      {user ? (
        <Button disabled={accept.isPending} onClick={() => accept.mutate({ token })}>
          {t("organization.join.accept", params)}
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSignUp}>{t("organization.join.signUp")}</Button>
          <Button variant="secondary" onClick={onSignIn}>
            {t("organization.join.signIn")}
          </Button>
        </div>
      )}
      {accept.isError ? (
        <Callout tone="danger">
          {describe(accept.error)?.envelope.code === "NOT_FOUND"
            ? t("organization.join.unverified")
            : describe(accept.error)?.message}
        </Callout>
      ) : null}
    </>
  );
}
