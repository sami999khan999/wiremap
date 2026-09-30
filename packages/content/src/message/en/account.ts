// What a signed-in person sees while managing their own account. Split from `auth`,
// which is the signed-out half: see docs/reference/namespace.md.
export const account = {
  // ── profile ──
  "account.profile": "Profile",
  "account.name": "Your name",
  "account.saveChanges": "Save changes",
  "account.saved": "Saved.",

  // ── password ──
  "account.changePassword": "Change password",
  "account.currentPassword": "Current password",
  "account.resetNewPassword": "New password",
  "account.changePasswordDone": "Your password is changed. Other devices have been signed out.",
  "account.changePasswordFailed": "That current password was not right.",

  // ── email ──
  "account.changeEmail": "Change email address",
  "account.newEmail": "New email address",
  "account.changeEmailSent":
    "We sent a confirmation to your current address. The change takes effect once you approve it there.",

  // ── two-factor, enrolment ──
  "account.twoFactorTitle": "Two-factor authentication",
  "account.twoFactorOff": "Off. Your password is the only thing protecting this account.",
  "account.twoFactorOn": "On. You will be asked for a code when you sign in.",
  "account.twoFactorEnable": "Turn on two-factor",
  "account.twoFactorDisable": "Turn off two-factor",
  "account.twoFactorConfirmPassword": "Confirm your password to continue",
  "account.twoFactorScan": "Scan this with your authenticator app.",
  "account.twoFactorManual": "Cannot scan? Enter this key by hand instead.",
  "account.twoFactorVerifyPrompt": "Enter the code your app is showing now to finish.",
  "account.twoFactorEnabled": "Two-factor is on.",
  "account.twoFactorDisabled": "Two-factor is off.",
  // Also in `auth`, for the sign-in challenge. Two keys rather than a shared one: the
  // words are the same in English and need not be in a language that inflects.
  "account.twoFactorCode": "Authentication code",
  "account.twoFactorFailed": "That code was not right.",

  // ── backup codes ──
  "account.backupCodes": "Backup codes",
  // Shown once, at enrolment. The sentence has to carry the whole warning, because
  // there is no second chance to explain it.
  "account.backupCodesHint":
    "Save these somewhere safe. Each one signs you in once if you lose your phone, and this is the only time they are shown.",
  "account.backupCodesRegenerate": "Generate new backup codes",
  "account.backupCodesRegenerated": "New codes. The old ones no longer work.",

  // ── linked accounts ──
  "account.linkedAccounts": "Linked accounts",
  "account.linkedAccountsHint": "Other ways to sign in to this account.",
  "account.linkGoogle": "Link a Google account",
  "account.unlink": "Unlink",
  // Absent rather than disabled: unlinking the only credential is how someone locks
  // themselves out of their own account.
  "account.unlinkLast": "This is the only way you can sign in, so it cannot be unlinked.",
  "account.socialFailed": "That sign-in did not complete.",

  // ── sessions ──
  "account.sessions": "Where you are signed in",
  "account.sessionCurrent": "This device",
  "account.sessionRevoke": "Sign out",
  // Does not promise immediacy: the cookie cache holds for up to a minute either way.
  "account.signOutEverywhere": "Sign out on all devices",
  "account.signOutEverywhereDone": "Every other device has been signed out.",
} as const;
