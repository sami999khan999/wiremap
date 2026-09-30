import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type AccountClient,
  AccountMutations,
  AccountQueries,
  Button,
  Callout,
  EmptyState,
  StatusBadge,
  useAppQuery,
} from "../import.js";

export interface ActiveSessionListProps {
  readonly account: AccountClient;
}

export function ActiveSessionList({ account }: ActiveSessionListProps) {
  const { t } = useMessages("account");
  // `common` for the states every list shares, `auth` for this screen's own copy.
  const shell = useMessages("common");
  // Renders the code the server sent rather than one generic sentence: a 403 and a
  // 409 are different things to be told.
  const describe = useErrorMessage();
  const sessions = useAppQuery(AccountQueries.sessions(account));

  const revoke = AccountMutations.useRevokeSession(account);
  const revokeOthers = AccountMutations.useRevokeOtherSessions(account);

  const rows = sessions.data ?? [];

  // Pending before empty: `data` is undefined until the first answer, so the empty state
  // used to render for everyone with sessions while the request was still in flight.
  if (sessions.isPending) return <EmptyState title={shell.t("state.loading")} />;
  if (sessions.isError) return <Callout tone="danger">{describe(sessions.error)?.message}</Callout>;
  if (rows.length === 0) return <EmptyState title={t("account.sessions")} />;

  return (
    <>
      <ul>
        {rows.map((session) => (
          <li key={session.id}>
            {
              // Unparsed: "Chrome on macOS" needs a lookup table that is wrong for every
              // browser released after it shipped.
            }
            <span>{session.userAgent ?? session.ipAddress ?? session.id}</span>

            {
              // On the row rather than beside the list, and without a Revoke: signing
              // yourself out of the page you are reading is what the button below is for.
            }
            {session.current ? (
              <StatusBadge tone="neutral">{t("account.sessionCurrent")}</StatusBadge>
            ) : (
              <Button
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ token: session.token })}
              >
                {t("account.sessionRevoke")}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {revoke.isError ? <Callout tone="danger">{describe(revoke.error)?.message}</Callout> : null}

      {revokeOthers.isSuccess ? (
        <Callout tone="success">{t("account.signOutEverywhereDone")}</Callout>
      ) : null}

      {
        // Every session but this one. The copy does not promise immediacy: the cookie
        // cache holds for up to a minute regardless.
      }
      <Button
        variant="danger"
        disabled={revokeOthers.isPending || rows.length <= 1}
        onClick={() => revokeOthers.mutate()}
      >
        {t("account.signOutEverywhere")}
      </Button>
    </>
  );
}
