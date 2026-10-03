import type {
  InvitationLinkId,
  OrganizationId,
  PaginationQuery,
  RoleId,
  UserId,
} from "../import.js";

export interface InvitationLinkRecord {
  readonly id: InvitationLinkId;
  readonly roleId: RoleId;
  readonly roleName: string;
  readonly createdBy: UserId;
  readonly creatorName: string;
  readonly expiresAt: Date;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly createdAt: Date;
}

export interface NewInvitationLink {
  readonly id: InvitationLinkId;
  readonly roleId: RoleId;
  readonly createdBy: UserId;
  // The digest only. The raw token leaves the server once, in `createLink`'s answer.
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly maxUses: number | null;
}

export interface InvitationLinkPage {
  readonly items: readonly InvitationLinkRecord[];
  readonly total: number;
}

// Live links only: an expired, used-up or revoked link is not listed, because nothing on
// the members page can be done with it.
export abstract class InvitationLinkRepository {
  public abstract list(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<InvitationLinkPage>;

  public abstract findById(
    organizationId: OrganizationId,
    id: InvitationLinkId,
  ): Promise<InvitationLinkRecord | null>;

  public abstract save(organizationId: OrganizationId, link: NewInvitationLink): Promise<void>;

  public abstract revoke(
    organizationId: OrganizationId,
    id: InvitationLinkId,
    at: Date,
  ): Promise<void>;
}
