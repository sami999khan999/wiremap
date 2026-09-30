// The two pages a person reaches from outside any tenant's settings: founding an
// organization of their own, and the landing page an invitation link opens.
export const organization = {
  "organization.create.title": "New organization",
  "organization.create.name": "Organization name",
  "organization.create.hint":
    "You will be its owner, and you can switch back to your other organizations at any time.",
  "organization.create.submit": "Create organization",

  "organization.invitation.title": "You have been invited",
  "organization.invitation.intro": "{organization} has invited {email} to join.",
  "organization.invitation.accept": "Join {organization}",
  "organization.invitation.signIn": "Sign in as {email}",
  "organization.invitation.signUp": "Create an account with {email}",
  // The address is the credential, so the fix is stated exactly: not "try again", but
  // sign in as the person the invitation names.
  "organization.invitation.wrongAccount":
    "This invitation was sent to {email}, but you are signed in as {current}. Sign out, then sign in with the invited address.",
  "organization.invitation.expired":
    "This invitation has expired. Ask someone at {organization} to send a new one.",
  // One sentence for revoked, already used and never existed. Distinguishing them
  // tells whoever holds a stale link more than they need to know.
  "organization.invitation.missing":
    "This invitation is no longer valid. It may have been revoked or already used.",
} as const;
