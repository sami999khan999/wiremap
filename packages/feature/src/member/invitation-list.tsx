import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Can,
  DateFormat,
  EmptyState,
  type InvitationDto,
  MemberMutations,
  MemberQueries,
  useApiClient,
  useAppQuery,
} from "../import.js";

export interface InvitationListProps {
  readonly limit?: number;
}

// Hiding the revoke button is a courtesy: the use-case asserts the same key, so a
// request without it is FORBIDDEN whether or not the button rendered.
export function InvitationList({ limit = 25 }: InvitationListProps) {
  const { t } = useMessages("member");
  // `common` for the states every list shares, `member` for this screen's own copy.
  const shell = useMessages("common");
  // Renders the code the server sent rather than one generic sentence: a 403 and a
  // 409 are different things to be told.
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  // One object, read by the query and by the optimistic edit that removes a row from it.
  // Built per render is fine: TanStack hashes a key structurally, not by identity.
  const params = { limit, offset: 0 };
  const invitations = useAppQuery(MemberQueries.invitations(client, params));
  const revoke = MemberMutations.useRevokeInvitation(client, params);
  const resend = MemberMutations.useResendInvitation(client);

  // Annotated rather than inferred: the client's procedure types are reconstructed
  // through two packages, and a break anywhere degrades to `any` silently.
  const rows: readonly InvitationDto[] = invitations.data?.items ?? [];

  // `null` while pending said nothing at all, so the panel looked like it had no
  // invitations and then grew one.
  if (invitations.isPending) return <EmptyState title={shell.t("state.loading")} />;
  if (invitations.isError)
    return <Callout tone="danger">{describe(invitations.error)?.message}</Callout>;
  if (rows.length === 0) return <EmptyState title={t("member.invitation.empty")} />;

  return (
    <>
      {
        // The outcome of the last resend, and it outlives the click: a button that
        // un-disables and says nothing has told the operator nothing.
      }
      {resend.isSuccess ? <Callout tone="success">{t("member.invitation.resent")}</Callout> : null}
      {resend.isError ? <Callout tone="danger">{describe(resend.error)?.message}</Callout> : null}
      <ul>
        {rows.map((invitation) => (
          <li key={invitation.id}>
            <span>{invitation.email}</span> <span>{invitation.roleName}</span>{" "}
            <small>
              {t("member.invitation.invitedBy", { name: invitation.inviterName })} ·{" "}
              {t("member.invitation.expires", { date: DateFormat.day(invitation.expiresAt) })}
            </small>{" "}
            <Can permission="member.invite" capabilities={capabilities}>
              <Button
                variant="ghost"
                disabled={resend.isPending}
                onClick={() => resend.mutate({ invitationId: invitation.id })}
              >
                {t("member.invitation.resend")}
              </Button>
              <Button
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ invitationId: invitation.id })}
              >
                {t("member.invitation.revoke")}
              </Button>
            </Can>
          </li>
        ))}
      </ul>
    </>
  );
}
