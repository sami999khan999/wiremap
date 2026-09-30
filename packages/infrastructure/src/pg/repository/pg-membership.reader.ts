import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  type OrganizationId,
  type Placement,
  sql,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { memberships, organizations, roles, users } from "../schema/index.js";

// One tenant a user may switch to. The same shape `MembershipReader` in `auth`
// declares, restated here because this package cannot import that one.
export interface OrganizationSummary {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly roleName: string;
}

// The role `SystemRoleSeed` gives a founder. Owning a tenant is holding this role in it,
// which is the only definition of "owner" that survives a role being renamed in the UI.
const OWNER_ROLE_KEY = "owner";

// Satisfies `MembershipReader` structurally, because `auth` already depends on this
// package. See docs/reference/enrollers.md.
export class PgMembershipReader extends BaseRepository {
  // `memberships` is RBAC, read before a key is known.
  protected override readonly placement: Placement = "catalog";

  // The switcher renders every row `organizationsFor` returns, so an unbounded read is a
  // list that grows without limit. Past this a user needs search, not a longer list.
  private static readonly MAX_ORGANIZATIONS = 100;

  // Once per sign-in, not per request. Last switched to while still a member, oldest
  // membership otherwise — so the answer is stable rather than planner-dependent.
  // ──
  // Active only (`CR.7`): pinned to a tenant that deactivated them, every request
  // answered anonymous and the loop never reached the switcher to leave it.
  public async activeOrganizationFor(userId: UserId): Promise<OrganizationId | null> {
    const [row] = await this.db
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.userId, userId),
          isNull(memberships.deactivatedAt),
          isNull(users.suspendedAt),
        ),
      )
      // `true` sorts first under `desc`. A user with no preference compares as null on
      // every row, and `nulls last` makes that a tie rather than a winner.
      .orderBy(
        sql`(${memberships.organizationId} = ${users.lastActiveOrganizationId}) desc nulls last`,
        asc(memberships.createdAt),
      )
      .limit(1);

    return (row?.organizationId as OrganizationId | undefined) ?? null;
  }

  // `application`'s side of the same question, tenant first like every port there.
  // One row on `memberships_uq`, so deactivation stays per membership.
  public isActiveMember(organizationId: OrganizationId, userId: UserId): Promise<boolean> {
    return this.isActive(userId, organizationId);
  }

  public async activeMemberIds(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlySet<UserId>> {
    if (userIds.length === 0) return new Set();

    const rows = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.userId, [...userIds]),
          isNull(memberships.deactivatedAt),
          isNull(users.suspendedAt),
        ),
      );

    return new Set(rows.map((row) => row.userId));
  }

  public async isActive(userId: UserId, organizationId: OrganizationId): Promise<boolean> {
    const [row] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      // A platform suspend outranks every tenant: one join, and each reader here refuses.
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          isNull(memberships.deactivatedAt),
          isNull(users.suspendedAt),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  // Oldest first, matching the fallback order above, so the switcher's list and the
  // sign-in default agree about which tenant is "first".
  public async organizationsFor(userId: UserId): Promise<readonly OrganizationSummary[]> {
    // Two joins, still one round trip. `memberships_user_uq` makes the role side
    // single-valued, so this cannot fan out a tenant into two rows.
    const rows = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        roleName: roles.name,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(users, eq(users.id, memberships.userId))
      // A tenant that deactivated this person is not one they can switch to.
      .where(
        and(
          eq(memberships.userId, userId),
          isNull(memberships.deactivatedAt),
          isNull(users.suspendedAt),
        ),
      )
      .orderBy(asc(memberships.createdAt))
      .limit(PgMembershipReader.MAX_ORGANIZATIONS);

    return rows;
  }

  // `count(*)` rather than counting `organizationsFor()`, which is itself capped — a
  // limit on the read used to check a limit would make the check pass at the ceiling.
  public async ownedCount(userId: UserId): Promise<number> {
    const [row] = await this.db
      .select({ owned: sql<number>`count(*)::int` })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userId), eq(roles.key, OWNER_ROLE_KEY)));

    return row?.owned ?? 0;
  }

  // No user row answers not suspended: the session hook runs after Better Auth found one.
  public async isSuspended(userId: UserId): Promise<boolean> {
    const [row] = await this.db
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row?.suspendedAt != null;
  }
}
