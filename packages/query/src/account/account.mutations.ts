import type { AccountClient, ActiveSession, LinkedAccount, TwoFactorEnrolment } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Everything a signed-in person can change about their own account. The counterpart to
// `SessionMutations`, split on the same line `AccountClient` and `AuthClient` are.
export class AccountMutations {
  private constructor() {}

  // The session list, not the session: every other device is gone, but this tab's own
  // session survives — which is why `QueryKeys.session` is absent.
  public static useChangePassword(account: AccountClient) {
    return useAppMutation<void, { currentPassword: string; newPassword: string }>({
      mutationFn: ({ currentPassword, newPassword }) =>
        account.changePassword(currentPassword, newPassword),
      invalidates: [QueryKeys.account.sessions()],
    });
  }

  // No invalidation. Nothing has changed yet — a confirmation has been sent to the old
  // address, and the address on the session only moves once that link is followed.
  public static useChangeEmail(account: AccountClient) {
    return useAppMutation<void, { newEmail: string; callbackURL: string }>({
      mutationFn: ({ newEmail, callbackURL }) => account.changeEmail(newEmail, callbackURL),
    });
  }

  // The rendered name lives on the session snapshot, so this is one of the few account
  // mutations that genuinely invalidates `["session"]`.
  public static useUpdateName(account: AccountClient) {
    return useAppMutation<void, { name: string }>({
      mutationFn: ({ name }) => account.updateName(name),
      invalidates: [QueryKeys.session.all()],
    });
  }

  // Invalidates nothing: two-factor is not on yet, so invalidating would make the page
  // claim protection the account does not have.
  public static useEnableTwoFactor(account: AccountClient) {
    return useAppMutation<TwoFactorEnrolment, { password: string }>({
      mutationFn: ({ password }) => account.enableTwoFactor(password),
    });
  }

  // The moment two-factor actually becomes true, so this is where the session is
  // invalidated — `user.twoFactorEnabled` is what the security page renders from.
  public static useVerifyTotpEnrolment(account: AccountClient) {
    return useAppMutation<void, { code: string }>({
      mutationFn: ({ code }) => account.verifyTotpEnrolment(code),
      invalidates: [QueryKeys.session.all(), QueryKeys.account.all()],
    });
  }

  public static useDisableTwoFactor(account: AccountClient) {
    return useAppMutation<void, { password: string }>({
      mutationFn: ({ password }) => account.disableTwoFactor(password),
      invalidates: [QueryKeys.session.all(), QueryKeys.account.all()],
    });
  }

  public static useRegenerateBackupCodes(account: AccountClient) {
    return useAppMutation<readonly string[], { password: string }>({
      mutationFn: ({ password }) => account.regenerateBackupCodes(password),
    });
  }

  // No invalidation: the success path is a redirect to Google, and the account list is
  // refetched by the settings page when the browser returns to it.
  public static useLinkGoogle(account: AccountClient) {
    return useAppMutation<void, { callbackURL: string }>({
      mutationFn: ({ callbackURL }) => account.linkGoogle(callbackURL),
    });
  }

  // Optimistic: the row is the whole feedback. Waiting for a round trip to remove a
  // provider the user just unlinked reads as a click that did nothing.
  public static useUnlinkAccount(account: AccountClient) {
    return useAppMutation<
      void,
      { providerId: string; accountId: string },
      readonly LinkedAccount[]
    >({
      mutationFn: ({ providerId, accountId }) => account.unlinkAccount(providerId, accountId),
      optimistic: {
        queryKey: QueryKeys.account.accounts(),
        apply: (cached, { providerId, accountId }) =>
          cached.filter(
            (linked) => linked.providerId !== providerId || linked.accountId !== accountId,
          ),
      },
    });
  }

  // The one row this must not remove optimistically is the current session, and it
  // cannot be reached: `ActiveSessionList` renders no revoke control beside it.
  public static useRevokeSession(account: AccountClient) {
    return useAppMutation<void, { token: string }, readonly ActiveSession[]>({
      mutationFn: ({ token }) => account.revokeSession(token),
      optimistic: {
        queryKey: QueryKeys.account.sessions(),
        apply: (cached, { token }) => cached.filter((session) => session.token !== token),
      },
    });
  }

  public static useRevokeOtherSessions(account: AccountClient) {
    return useAppMutation<void, void>({
      mutationFn: () => account.revokeOtherSessions(),
      invalidates: [QueryKeys.account.sessions()],
    });
  }
}
