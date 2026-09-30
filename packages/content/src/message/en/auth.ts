// The copy for every flow `@loadbearing/auth` implements *before* there is a session.
// A signed-in person managing their account reads `account` — see docs/reference/namespace.md.
export const auth = {
  // ── sign-in ──
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.email": "Email",
  "auth.password": "Password",
  // Deliberately one sentence for both "no such account" and "wrong password".
  // Distinguishing them tells an attacker which addresses are registered.
  "auth.signInFailed": "That email and password did not match.",
  "auth.forgotPassword": "Forgot your password?",
  "auth.noAccount": "No account yet?",
  "auth.haveAccount": "Already have an account?",

  // ── sign-up ──
  "auth.signUp": "Create an account",
  "auth.signingUp": "Creating your account…",
  "auth.name": "Your name",
  "auth.confirmPassword": "Confirm password",
  "auth.passwordMismatch": "Those passwords do not match.",
  "auth.passwordTooShort": "Use at least 12 characters.",
  // The one place this system cannot avoid confirming an address is registered: the
  // alternative claims an account was created when it was not.
  "auth.emailTaken": "There is already an account with that email. Try signing in instead.",
  "auth.signUpFailed": "That account could not be created.",

  // ── verification ──
  "auth.verifyEmail": "Check your inbox to confirm your email address.",
  "auth.verifyEmailSent": "We sent a link to {email}. Open it to finish setting up your account.",
  "auth.verifyEmailResend": "Send it again",
  "auth.verifyEmailResent": "Sent. Give it a minute, then check your spam folder.",
  "auth.verifyEmailDone": "Your email address is confirmed. You can sign in now.",
  "auth.verifyEmailFailed": "That link has expired or has already been used.",

  // ── password reset ──
  "auth.resetRequest": "Send a reset link",
  // Shown whether or not the address exists, for the same reason `signInFailed` is
  // generic. The wording has to be true in both cases, which is why it says "if".
  "auth.resetSent": "If that email has an account, a reset link is on its way.",
  "auth.resetTitle": "Choose a new password",
  "auth.resetNewPassword": "New password",
  "auth.resetSubmit": "Save this password",
  "auth.resetDone": "Your password is saved. Sign in with it.",
  "auth.resetFailed": "That reset link has expired or has already been used.",

  // ── two-factor, at sign-in ──
  "auth.twoFactorCode": "Authentication code",
  "auth.twoFactorHint": "Enter the six-digit code from your authenticator app.",
  "auth.twoFactorUseBackup": "Use a backup code instead",
  "auth.twoFactorUseTotp": "Use your authenticator app instead",
  "auth.twoFactorUseOtp": "Email me a code instead",
  "auth.twoFactorBackupCode": "Backup code",
  "auth.twoFactorBackupHint": "Each backup code works once. Enter one you have not used.",
  "auth.twoFactorOtpSend": "Send a code to my email",
  "auth.twoFactorOtpSent": "We sent a code to your email address. It expires in five minutes.",
  "auth.twoFactorFailed": "That code was not right.",

  // ── social ──
  "auth.continueWithGoogle": "Continue with Google",
  "auth.orDivider": "or",
  "auth.socialFailed": "That sign-in did not complete.",
} as const;
