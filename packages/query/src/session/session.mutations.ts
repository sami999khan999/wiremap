import type { AuthClient } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Everything an anonymous visitor can start; the signed-in half is `AccountMutations`.
// See docs/reference/mutations.md.
export class SessionMutations {
  private constructor() {}

  public static useSignIn(auth: AuthClient) {
    return useAppMutation<void, { email: string; password: string }>({
      mutationFn: ({ email, password }) => auth.signIn(email, password),
      invalidates: [QueryKeys.session.all()],
    });
  }

  // No `invalidates`: a sign-up issues no session, so this would refetch one that is
  // still, correctly, anonymous.
  public static useSignUp(auth: AuthClient) {
    return useAppMutation<
      void,
      { name: string; email: string; password: string; callbackURL: string }
    >({
      mutationFn: ({ name, email, password, callbackURL }) =>
        auth.signUp(name, email, password, callbackURL),
    });
  }

  // Also no `invalidates`: the success path is a full-page navigation, so nothing in
  // this cache survives to be invalidated.
  public static useSignInWithGoogle(auth: AuthClient) {
    return useAppMutation<void, { callbackURL: string; errorCallbackURL: string }>({
      mutationFn: ({ callbackURL, errorCallbackURL }) =>
        auth.signInWithGoogle(callbackURL, errorCallbackURL),
    });
  }

  public static useSignInWithGitHub(auth: AuthClient) {
    return useAppMutation<void, { callbackURL: string; errorCallbackURL: string }>({
      mutationFn: ({ callbackURL, errorCallbackURL }) =>
        auth.signInWithGitHub(callbackURL, errorCallbackURL),
    });
  }

  // Resolves whether or not the address exists — see `AuthClient.requestPasswordReset`.
  // The form renders one message either way, and `isSuccess` is that signal.
  public static useRequestPasswordReset(auth: AuthClient) {
    return useAppMutation<void, { email: string; redirectTo: string }>({
      mutationFn: ({ email, redirectTo }) => auth.requestPasswordReset(email, redirectTo),
    });
  }

  // `revokeSessionsOnPasswordReset` is on, so every session this user had is gone by
  // the time this resolves — including, if they were somehow signed in, this one.
  public static useResetPassword(auth: AuthClient) {
    return useAppMutation<void, { token: string; newPassword: string }>({
      mutationFn: ({ token, newPassword }) => auth.resetPassword(token, newPassword),
      invalidates: [QueryKeys.session.all()],
    });
  }

  public static useResendVerification(auth: AuthClient) {
    return useAppMutation<void, { email: string; callbackURL: string }>({
      mutationFn: ({ email, callbackURL }) => auth.sendVerificationEmail(email, callbackURL),
    });
  }

  // The three ways to finish a sign-in that answered TWO_FACTOR_REQUIRED. Each completes
  // one, so each invalidates the session the route is about to re-read.

  public static useVerifyTotp(auth: AuthClient) {
    return useAppMutation<void, { code: string }>({
      mutationFn: ({ code }) => auth.verifyTwoFactor(code),
      invalidates: [QueryKeys.session.all()],
    });
  }

  public static useVerifyBackupCode(auth: AuthClient) {
    return useAppMutation<void, { code: string }>({
      mutationFn: ({ code }) => auth.verifyBackupCode(code),
      invalidates: [QueryKeys.session.all()],
    });
  }

  public static useVerifyOtp(auth: AuthClient) {
    return useAppMutation<void, { code: string }>({
      mutationFn: ({ code }) => auth.verifyTwoFactorOtp(code),
      invalidates: [QueryKeys.session.all()],
    });
  }

  // No `invalidates`: it sends a code and completes nothing, so there is no session yet
  // to refetch.
  public static useSendOtp(auth: AuthClient) {
    return useAppMutation<void, void>({
      mutationFn: () => auth.sendTwoFactorOtp(),
    });
  }

  // No `invalidates`. Sign-out has to clear the *entire* cache, and that is a lifecycle
  // decision the call site makes. See docs/reference/mutations.md.
  public static useSignOut(auth: AuthClient, onDone?: () => void) {
    return useAppMutation<void, void>({
      mutationFn: () => auth.signOut(),
      onSuccess: onDone,
    });
  }
}
