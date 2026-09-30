export const memberActions = {
  "member.invited": { label: "Member invited" },
  "member.joined": { label: "Member joined" },
  "member.invitation.revoked": { label: "Invitation revoked" },
  // A resend issues a new token and voids the old link, which is a change to what the
  // row holds rather than a repeat of the invitation.
  "member.invitation.resent": { label: "Invitation resent" },
  "member.role.changed": { label: "Member role changed" },
  // Two actions from one call site, which is why both are entries: the use-case picks
  // between them on the value it is writing.
  "member.deactivated": { label: "Member deactivated" },
  "member.reactivated": { label: "Member reactivated" },
} as const;
