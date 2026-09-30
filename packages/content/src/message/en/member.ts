export const member = {
  "member.title": "Members",
  "member.subtitle": "Who belongs to this organization, and who has been asked to join.",
  "member.column.name": "Name",
  "member.column.email": "Email",
  "member.column.role": "Role",
  "member.column.joined": "Joined",
  "member.badge.owner": "Owner",
  "member.badge.deactivated": "Deactivated",
  "member.badge.suspended": "Suspended by the platform",
  "member.empty": "Nobody here yet.",

  "member.invitation.title": "Pending invitations",
  "member.invitation.empty": "No pending invitations.",
  "member.invitation.invitedBy": "Invited by {name}",
  "member.invitation.expires": "Expires {date}",
  "member.invitation.resend": "Resend",
  // Said out loud, because it is not what "resend" implies: the old link stops working,
  // and somebody forwarding the first mail needs to know that.
  "member.invitation.resent": "Sent again. The previous link no longer works.",
  "member.invitation.revoke": "Revoke",

  "member.invite.title": "Invite someone",
  "member.invite.email": "Email address",
  "member.invite.role": "Role",
  "member.invite.submit": "Send invitation",
  "member.invite.sent": "Invitation sent to {email}. It expires in seven days.",
  // The one failure worth its own sentence: the generic conflict copy talks about a
  // concurrent edit, which is not what happened.
  "member.invite.alreadyMember": "That address already belongs to a member of this organization.",

  // ── lifecycle ──
  "member.column.actions": "Actions",
  "member.action.deactivate": "Deactivate",
  "member.action.reactivate": "Reactivate",
  "member.action.changeRole": "Change role",
  "member.action.inspect": "Why?",
  "member.inspect.title": "What {name} can do here",
  "member.inspect.close": "Close",
  // Two refusals worth their own sentence, because the generic conflict copy — "someone
  // else changed this first" — is wrong about both.
  "member.error.lastOwner": "This is the only active owner. Promote someone else to owner first.",
  "member.error.self": "You cannot deactivate your own membership.",

  "member.exception.one": "+ 1 exception",
  "member.exception.other": "+ {count} exceptions",
  "member.action.access": "Access",
  "member.access.title": "Access and exceptions",
  "member.access.close": "Close",
} as const;
