import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  type MemberPage,
  type MemberRecord,
  type MemberRepository,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  type RoleId,
  sql,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import {
  goalMembers,
  memberships,
  permissionOverrides,
  roles,
  teamMembers,
  users,
} from "../schema/index.js";

// Live overrides for the row's membership, on `permission_overrides_user_idx`. Named in full:
// drizzle writes a column unqualified in a one-table select, and `po` would capture it.
const EXCEPTIONS = sql<number>`(select count(*)::int from permission_overrides po
  where po.organization_id = "memberships"."organization_id"
    and po.user_id = "memberships"."user_id"
    and (po.expires_at is null or po.expires_at > now()))`;

export class PgMemberRepository extends BaseRepository implements MemberRepository {
  // `memberships` is RBAC.
  protected override readonly placement: Placement = "catalog";

  // Two queries, fixed: the page and the total. A per-member join lookup is an N+1 that
  // is invisible at four members and the whole request at four hundred.
  public async list(organizationId: OrganizationId, page: PaginationQuery): Promise<MemberPage> {
    const rows = await this.db
      .select({
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        roleId: memberships.roleId,
        roleKey: roles.key,
        roleName: roles.name,
        joinedAt: memberships.createdAt,
        deactivatedAt: memberships.deactivatedAt,
        suspendedAt: users.suspendedAt,
        exceptions: EXCEPTIONS,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      // Every read narrows by tenant. There is no code path here that could omit it.
      .where(eq(memberships.organizationId, organizationId))
      // By joining order, so a page boundary is stable between requests.
      .orderBy(asc(memberships.createdAt))
      .limit(page.limit)
      .offset(page.offset);

    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(memberships)
      .where(eq(memberships.organizationId, organizationId));

    const items: MemberRecord[] = rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      roleId: row.roleId as RoleId,
      roleKey: row.roleKey,
      roleName: row.roleName,
      joinedAt: row.joinedAt,
      deactivated: row.deactivatedAt !== null,
      suspended: row.suspendedAt !== null,
      exceptions: row.exceptions,
    }));

    return { items, total: counted?.total ?? 0 };
  }

  // The same projection `list` builds, for one row. Written as its own query rather than
  // reusing `list` with a filter: a page query with `limit: 1` still counts the table.
  public async findByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<MemberRecord | null> {
    const [row] = await this.db
      .select({
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        roleId: memberships.roleId,
        roleKey: roles.key,
        roleName: roles.name,
        joinedAt: memberships.createdAt,
        deactivatedAt: memberships.deactivatedAt,
        suspendedAt: users.suspendedAt,
        exceptions: EXCEPTIONS,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1);

    if (!row) return null;

    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      roleId: row.roleId as RoleId,
      roleKey: row.roleKey,
      roleName: row.roleName,
      joinedAt: row.joinedAt,
      deactivated: row.deactivatedAt !== null,
      suspended: row.suspendedAt !== null,
      exceptions: row.exceptions,
    };
  }

  public async changeRole(
    organizationId: OrganizationId,
    userId: UserId,
    roleId: RoleId,
  ): Promise<void> {
    await this.db
      .update(memberships)
      .set({ roleId })
      // Both columns, always: without the tenant this updates by user id across every
      // organization the person belongs to.
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  }

  public async setDeactivatedAt(
    organizationId: OrganizationId,
    userId: UserId,
    at: Date | null,
  ): Promise<void> {
    await this.db
      .update(memberships)
      .set({ deactivatedAt: at })
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  }

  // Four tenant-scoped deletes in the caller's transaction, membership last. What hangs off
  // the person goes first, so no grant outlives the membership that justified it.
  public async delete(organizationId: OrganizationId, userId: UserId): Promise<void> {
    await this.db
      .delete(goalMembers)
      .where(and(eq(goalMembers.organizationId, organizationId), eq(goalMembers.userId, userId)));
    await this.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.userId, userId)));
    await this.db
      .delete(permissionOverrides)
      .where(
        and(
          eq(permissionOverrides.organizationId, organizationId),
          eq(permissionOverrides.userId, userId),
        ),
      );
    await this.db
      .delete(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  }

  public async countActiveHolders(
    organizationId: OrganizationId,
    roleKeys: readonly string[],
  ): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(this.activeHolders(organizationId, roleKeys));

    return row?.total ?? 0;
  }

  // `for update` on the membership rows, not on the joined role: an aggregate cannot
  // carry the clause, so the rows come back and are counted here.
  public async lockActiveHolders(
    organizationId: OrganizationId,
    roleKeys: readonly string[],
  ): Promise<number> {
    const rows = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(this.activeHolders(organizationId, roleKeys))
      .for("update", { of: memberships });

    return rows.length;
  }

  // A suspended account cannot act anywhere, so it never counts as the one keeping a tenant open.
  private activeHolders(organizationId: OrganizationId, roleKeys: readonly string[]) {
    return and(
      eq(memberships.organizationId, organizationId),
      inArray(roles.key, [...roleKeys]),
      isNull(memberships.deactivatedAt),
      isNull(users.suspendedAt),
    );
  }

  public async existsByEmail(organizationId: OrganizationId, email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(sql`lower(${users.email})`, email.toLowerCase()),
        ),
      )
      .limit(1);

    return row !== undefined;
  }
}
