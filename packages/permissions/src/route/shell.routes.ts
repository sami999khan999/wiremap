import type { RoutePath } from "./index.js";

// App-level destinations belonging to no feature slice. A feature team has no reason to
// edit this file, which is what separates it from the fragments beside it.
export const shellRoutes = {
  home: "/",
  // Where a signed-in visitor to `home` is sent. `home` stays the landing page for everyone else.
  dashboard: "/dashboard",
  signIn: "/sign-in",
  signUp: "/sign-up",
  // The two halves of a password reset. `resetPassword` is where Better Auth redirects
  // with the token, so this spelling and the client's `redirectTo` have to agree.
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  // Where a verification link lands after Better Auth has consumed the token, and where
  // an unverified sign-up is told to go and look in its inbox.
  verifyEmail: "/verify-email",
  forbidden: "/forbidden",
  // Needs no session: the person holding the link may have no account yet. The mailer
  // builds the link from this entry, so the two agree by construction.
  invitation: "/invitation",
} as const satisfies Record<string, RoutePath>;
