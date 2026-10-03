import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

export class MemberContract {
  private constructor() {}

  // One person in this organization, as the members page lists them. `roleKey` rides
  // beside `roleName` because `owner` is worth recognising without a lookup.
  public static readonly entity = z.object({
    userId: Identifiers.userId,
    name: z.string(),
    email: z.string(),
    roleId: Identifiers.roleId,
    roleKey: z.string().min(1),
    roleName: z.string().min(1),
    // `z.date()`, not an ISO string: the RPC link serialises dates natively, so the
    // shape the repository returns is the shape a component renders.
    joinedAt: z.date(),
    deactivated: z.boolean(),
    // The platform's lock on the whole account. This tenant's admin sees it and cannot lift it.
    suspended: z.boolean(),
    // Live per-person overrides: "Accountant + 2 exceptions" on the list.
    exceptions: z.number().int().nonnegative(),
  });

  // A pending invitation. Deliberately without the token — the link is in the invited
  // person's inbox, and the members page has no business re-issuing it.
  public static readonly invitation = z.object({
    id: Identifiers.invitationId,
    email: z.string(),
    roleId: Identifiers.roleId,
    roleName: z.string().min(1),
    invitedBy: Identifiers.userId,
    inviterName: z.string(),
    organizationName: z.string(),
    expiresAt: z.date(),
    createdAt: z.date(),
  });

  public static readonly invite = z.object({
    // The full RFC length. Lowercased by the use-case, not here — a schema that rewrites
    // its input makes the same string parse to two different values in two places.
    email: z.email().max(254),
    roleId: Identifiers.roleId,
  });

  public static readonly revoke = z.object({
    invitationId: Identifiers.invitationId,
  });

  // Its own shape rather than `revoke` reused: the two carry the same field today and
  // have no reason to move together tomorrow.
  public static readonly resend = z.object({
    invitationId: Identifiers.invitationId,
  });

  // The member is addressed by `userId`, not by a membership id: the caller holds a
  // row from `list`, and `(organizationId, userId)` is what the unique index is on.
  public static readonly changeRole = z.object({
    userId: Identifiers.userId,
    roleId: Identifiers.roleId,
  });

  public static readonly setActive = z.object({
    userId: Identifiers.userId,
  });

  // Ends the membership. Addressed like every other member procedure, by the person.
  public static readonly remove = z.object({
    userId: Identifiers.userId,
  });

  // A shareable invitation: anyone with a verified address who opens it joins with its
  // role, until it expires, is used up, or is revoked. The token is never listed.
  public static readonly invitationLink = z.object({
    id: Identifiers.invitationLinkId,
    roleId: Identifiers.roleId,
    roleName: z.string().min(1),
    createdBy: Identifiers.userId,
    creatorName: z.string(),
    expiresAt: z.date(),
    // Null is unlimited until it expires.
    maxUses: z.number().int().positive().nullable(),
    uses: z.number().int().nonnegative(),
    createdAt: z.date(),
  });

  // What `createLink` answers, once: the only moment the raw token exists outside a mailbox.
  public static readonly createdInvitationLink = MemberContract.invitationLink.extend({
    token: z.string().min(1),
  });

  public static readonly createLink = z.object({
    roleId: Identifiers.roleId,
    expiresInDays: z.number().int().min(1).max(30),
    maxUses: z.number().int().min(1).max(1000).nullable(),
  });

  public static readonly revokeLink = z.object({
    linkId: Identifiers.invitationLinkId,
  });

  // A claimed email domain: a verified sign-up at it joins this organization with `roleId`.
  public static readonly domain = z.object({
    id: Identifiers.domainId,
    domain: z.string().min(1),
    roleId: Identifiers.roleId,
    roleName: z.string().min(1),
    createdBy: Identifiers.userId,
    createdAt: z.date(),
  });

  // A hostname, not a URL. Lowercased by the use-case, for the reason `invite` gives.
  public static readonly addDomain = z.object({
    domain: z
      .string()
      .trim()
      .min(3)
      .max(253)
      .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i),
    roleId: Identifiers.roleId,
  });

  public static readonly removeDomain = z.object({
    domainId: Identifiers.domainId,
  });

  public static readonly listQuery = Pagination.query;
}

export type MemberDto = z.infer<typeof MemberContract.entity>;
export type InvitationDto = z.infer<typeof MemberContract.invitation>;
export type InviteMemberInput = z.infer<typeof MemberContract.invite>;
export type RevokeInvitationInput = z.infer<typeof MemberContract.revoke>;
export type ResendInvitationInput = z.infer<typeof MemberContract.resend>;
export type ChangeMemberRoleInput = z.infer<typeof MemberContract.changeRole>;
export type SetMemberActiveInput = z.infer<typeof MemberContract.setActive>;
export type RemoveMemberInput = z.infer<typeof MemberContract.remove>;
export type InvitationLinkDto = z.infer<typeof MemberContract.invitationLink>;
export type CreatedInvitationLinkDto = z.infer<typeof MemberContract.createdInvitationLink>;
export type CreateInvitationLinkInput = z.infer<typeof MemberContract.createLink>;
export type RevokeInvitationLinkInput = z.infer<typeof MemberContract.revokeLink>;
export type DomainDto = z.infer<typeof MemberContract.domain>;
export type AddDomainInput = z.infer<typeof MemberContract.addDomain>;
export type RemoveDomainInput = z.infer<typeof MemberContract.removeDomain>;
