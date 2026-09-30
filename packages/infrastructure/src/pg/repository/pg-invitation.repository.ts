import {
  and,
  asc,
  eq,
  gt,
  type InvitationId,
  type InvitationPage,
  type InvitationRecord,
  type InvitationRepository,
  type NewInvitation,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  type RoleId,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { invitations, organizations, roles, users } from "../schema/index.js";

// The administrator's side of `invitations`: this one never selects `token`, and the
// claimer beside it never lists.
export class PgInvitationRepository extends BaseRepository implements InvitationRepository {
  // `invitations` arrives holding no tenant.
  protected override readonly placement: Placement = "catalog";

  public async list(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<InvitationPage> {
    // Unexpired only. An expired row is still there until something sweeps it, and
    // `findById` still reaches it so it can be revoked.
    const pending = and(
      eq(invitations.organizationId, organizationId),
      gt(invitations.expiresAt, sql`now()`),
    );

    const rows = await this.select()
      .where(pending)
      .orderBy(asc(invitations.createdAt))
      .limit(page.limit)
      .offset(page.offset);

    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(invitations)
      .where(pending);

    return {
      items: rows.map((row) => PgInvitationRepository.toRecord(row)),
      total: counted?.total ?? 0,
    };
  }

  public async findById(
    organizationId: OrganizationId,
    id: InvitationId,
  ): Promise<InvitationRecord | null> {
    const [row] = await this.select()
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.id, id)))
      .limit(1);

    return row ? PgInvitationRepository.toRecord(row) : null;
  }

  // Upsert on `invitations_email_uq`, replacing the first outright — including its id, so
  // the old link stops working the moment the new one is sent.
  public async save(invitation: NewInvitation): Promise<void> {
    await this.db
      .insert(invitations)
      .values(invitation)
      .onConflictDoUpdate({
        target: [invitations.organizationId, invitations.email],
        set: {
          id: invitation.id,
          roleId: invitation.roleId,
          tokenHash: invitation.tokenHash,
          invitedBy: invitation.invitedBy,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      });
  }

  public async delete(organizationId: OrganizationId, id: InvitationId): Promise<void> {
    await this.db
      .delete(invitations)
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.id, id)));
  }

  // One projection for both reads, so a column added to the record is added once.
  private select() {
    return this.db
      .select({
        id: invitations.id,
        email: invitations.email,
        roleId: invitations.roleId,
        roleName: roles.name,
        invitedBy: invitations.invitedBy,
        inviterName: users.name,
        organizationName: organizations.name,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .innerJoin(users, eq(users.id, invitations.invitedBy))
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId));
  }

  private static toRecord(row: {
    id: string;
    email: string;
    roleId: string;
    roleName: string;
    invitedBy: InvitationRecord["invitedBy"];
    inviterName: string;
    organizationName: string;
    expiresAt: Date;
    createdAt: Date;
  }): InvitationRecord {
    return {
      id: row.id as InvitationId,
      email: row.email,
      roleId: row.roleId as RoleId,
      roleName: row.roleName,
      invitedBy: row.invitedBy,
      inviterName: row.inviterName,
      organizationName: row.organizationName,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
