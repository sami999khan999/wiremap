import type { InvitationId, OrganizationId, PaginationQuery, RoleId, UserId } from "../import.js";

// The *digest* appears here and nowhere else in this file. The token itself never
// reaches a repository: hashing is the use-case's job, and only the mail carries it.
export interface NewInvitation {
  readonly id: InvitationId;
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly roleId: RoleId;
  readonly tokenHash: string;
  readonly invitedBy: UserId;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

// The row joined to the names a list and a mail need. No token and no tenant: the tenant
// is the query's scope, and the token is not for reading.
export interface InvitationRecord {
  readonly id: InvitationId;
  readonly email: string;
  readonly roleId: RoleId;
  readonly roleName: string;
  readonly invitedBy: UserId;
  readonly inviterName: string;
  readonly organizationName: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface InvitationPage {
  readonly items: readonly InvitationRecord[];
  readonly total: number;
}

// A repository port, so it lives with its subject rather than in `port/`.
export abstract class InvitationRepository {
  // Pending and unexpired only — what an administrator can still act on.
  public abstract list(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<InvitationPage>;

  // Expired rows included, so a stale one can still be revoked by id.
  public abstract findById(
    organizationId: OrganizationId,
    id: InvitationId,
  ): Promise<InvitationRecord | null>;

  // Upserts on `(organization_id, email)`: a second invitation replaces the pending one
  // rather than failing.
  public abstract save(invitation: NewInvitation): Promise<void>;

  public abstract delete(organizationId: OrganizationId, id: InvitationId): Promise<void>;
}
