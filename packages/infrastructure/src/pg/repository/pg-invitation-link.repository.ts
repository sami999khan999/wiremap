import {
  and,
  desc,
  eq,
  gt,
  type InvitationLinkId,
  type InvitationLinkPage,
  type InvitationLinkRecord,
  type InvitationLinkRepository,
  isNull,
  type NewInvitationLink,
  type OrganizationId,
  or,
  type PaginationQuery,
  type Placement,
  type RoleId,
  sql,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { invitationLinks, roles, users } from "../schema/index.js";

// The administrator's side of `invitation_links`: it never selects the token digest, and
// the claimer beside it never lists.
export class PgInvitationLinkRepository extends BaseRepository implements InvitationLinkRepository {
  protected override readonly placement: Placement = "catalog";

  public async list(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<InvitationLinkPage> {
    // Live only: unexpired, unrevoked, and with uses left.
    const live = and(
      eq(invitationLinks.organizationId, organizationId),
      gt(invitationLinks.expiresAt, sql`now()`),
      isNull(invitationLinks.revokedAt),
      or(
        isNull(invitationLinks.maxUses),
        sql`${invitationLinks.uses} < ${invitationLinks.maxUses}`,
      ),
    );

    const rows = await this.select()
      .where(live)
      .orderBy(desc(invitationLinks.createdAt))
      .limit(page.limit)
      .offset(page.offset);
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(invitationLinks)
      .where(live);

    return {
      items: rows.map((row) => PgInvitationLinkRepository.toRecord(row)),
      total: counted?.total ?? 0,
    };
  }

  public async findById(
    organizationId: OrganizationId,
    id: InvitationLinkId,
  ): Promise<InvitationLinkRecord | null> {
    const [row] = await this.select()
      .where(and(eq(invitationLinks.organizationId, organizationId), eq(invitationLinks.id, id)))
      .limit(1);
    return row ? PgInvitationLinkRepository.toRecord(row) : null;
  }

  public async save(organizationId: OrganizationId, link: NewInvitationLink): Promise<void> {
    await this.db.insert(invitationLinks).values({ ...link, organizationId });
  }

  public async revoke(
    organizationId: OrganizationId,
    id: InvitationLinkId,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(invitationLinks)
      .set({ revokedAt: at })
      .where(and(eq(invitationLinks.organizationId, organizationId), eq(invitationLinks.id, id)));
  }

  private select() {
    return this.db
      .select({
        id: invitationLinks.id,
        roleId: invitationLinks.roleId,
        roleName: roles.name,
        createdBy: invitationLinks.createdBy,
        creatorName: users.name,
        expiresAt: invitationLinks.expiresAt,
        maxUses: invitationLinks.maxUses,
        uses: invitationLinks.uses,
        createdAt: invitationLinks.createdAt,
      })
      .from(invitationLinks)
      .innerJoin(roles, eq(roles.id, invitationLinks.roleId))
      .innerJoin(users, eq(users.id, invitationLinks.createdBy));
  }

  private static toRecord(row: {
    id: string;
    roleId: string;
    roleName: string;
    createdBy: string;
    creatorName: string;
    expiresAt: Date;
    maxUses: number | null;
    uses: number;
    createdAt: Date;
  }): InvitationLinkRecord {
    return {
      ...row,
      id: row.id as InvitationLinkId,
      roleId: row.roleId as RoleId,
      createdBy: row.createdBy as UserId,
    };
  }
}
