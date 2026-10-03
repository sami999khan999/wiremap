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

  // ── settings: the organization itself ──
  "organization.settings.title": "Organization",
  "organization.settings.profile": "Profile",
  "organization.settings.name": "Name",
  "organization.settings.slug": "URL name",
  "organization.settings.slugHint":
    "Fixed when the organization was created. A delete is confirmed by typing it.",
  "organization.settings.save": "Save name",
  "organization.settings.saved": "Saved.",

  "organization.transfer.title": "Transfer ownership",
  "organization.transfer.intro":
    "Hand this organization to another active member. They become its owner and you become an administrator.",
  "organization.transfer.member": "New owner",
  "organization.transfer.submit": "Transfer ownership",
  "organization.transfer.confirm":
    "Make {name} the owner? You will become an administrator, and only they can make you owner again.",
  "organization.transfer.done": "{name} is now the owner.",
  "organization.transfer.none":
    "Invite someone first: there is no other active member to hand it to.",

  "organization.delete.title": "Delete organization",
  "organization.delete.intro":
    "Every project, scan, comment and member goes with it. Exports are kept for 7 days. This cannot be undone.",
  "organization.delete.confirmLabel": "Type {slug} to confirm",
  "organization.delete.submit": "Delete organization",
  "organization.delete.queued": "Deletion has started. You will be moved to another organization.",
  "organization.delete.platform": "The platform organization cannot be deleted.",

  // ── the join page a shareable link opens ──
  "organization.join.title": "Join {organization}",
  "organization.join.intro": "This link adds you to {organization} as {role}.",
  "organization.join.accept": "Join {organization}",
  "organization.join.signIn": "Sign in to join",
  "organization.join.signUp": "Create an account to join",
  "organization.join.unverified": "Verify your email address first, then open this link again.",
  "organization.join.dead":
    "This link no longer works. It may have expired, been used up, or been revoked. Ask for a new one.",
} as const;
