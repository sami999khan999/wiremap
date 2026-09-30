import type {
  AccountDeny,
  AccountMembership,
  AccountRecord,
  AccountRepository,
  OrganizationId,
  Placement,
  UserId,
} from "../../import.js";
import { and, asc, eq, isNull, sql } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import {
  memberships,
  organizations,
  permissionOverrides,
  rolePermissions,
  roles,
  users,
} from "../schema/index.js";

type AccountRow = Pick<AccountRecord, "userId" | "email" | "name" | "suspendedAt">;

// The platform's view of one account across every tenant. `users`, the memberships and the
// overrides are all catalog, which is what lets one repository answer the whole screen.
export class PgAccountRepository extends BaseRepository implements AccountRepository {
  protected override readonly placement: Placement = "catalog";

  private static readonly ACCOUNT = {
    userId: users.id,
    email: users.email,
    name: users.name,
    suspendedAt: users.suspendedAt,
  };

  // Lower-cased here rather than `lower(email)` in SQL: Better Auth stores it lower-cased,
  // and this way the lookup stays on `users_email_unique`.
  public async findByEmail(email: string): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select(PgAccountRepository.ACCOUNT)
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    return row ? this.complete(row) : null;
  }

  public async findById(userId: UserId): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select(PgAccountRepository.ACCOUNT)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ? this.complete(row) : null;
  }

  public async saveSuspension(userId: UserId, suspendedAt: Date | null): Promise<void> {
    await this.db.update(users).set({ suspendedAt }).where(eq(users.id, userId));
  }

  // One statement. The deny is a correlated `not exists` naming its outer columns in full,
  // because drizzle writes them bare and Postgres binds a bare `user_id` to the inner table.
  public async holdersOf(
    platformOrganizationId: OrganizationId,
    permission: string,
  ): Promise<readonly UserId[]> {
    const rows = await this.db
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.roleId, memberships.roleId),
          eq(rolePermissions.organizationId, memberships.organizationId),
          eq(rolePermissions.permission, permission),
        ),
      )
      .where(
        and(
          eq(memberships.organizationId, platformOrganizationId),
          isNull(memberships.deactivatedAt),
          isNull(users.suspendedAt),
          sql`not exists (
            select 1 from ${permissionOverrides} po
            where po.organization_id = "memberships"."organization_id"
              and po.user_id = "memberships"."user_id"
              and po.permission = ${permission}
              and po.effect = 'deny'
              and po.authority = 'platform'
          )`,
        ),
      );

    return rows.map((row) => row.userId);
  }

  // Two more statements, in parallel: both lead with the user on an index of their own.
  private async complete(account: AccountRow): Promise<AccountRecord> {
    const [joined, denied] = await Promise.all([
      this.db
        .select({
          organizationId: memberships.organizationId,
          name: organizations.name,
          slug: organizations.slug,
          roleName: roles.name,
          deactivatedAt: memberships.deactivatedAt,
        })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.userId, account.userId))
        .orderBy(asc(memberships.createdAt)),
      this.db
        .select({
          id: permissionOverrides.id,
          organizationId: permissionOverrides.organizationId,
          permission: permissionOverrides.permission,
          reason: permissionOverrides.reason,
          createdAt: permissionOverrides.createdAt,
        })
        .from(permissionOverrides)
        .where(
          and(
            eq(permissionOverrides.userId, account.userId),
            eq(permissionOverrides.authority, "platform"),
          ),
        )
        .orderBy(asc(permissionOverrides.createdAt)),
    ]);

    const toMembership = (row: (typeof joined)[number]): AccountMembership => ({
      organizationId: row.organizationId as OrganizationId,
      name: row.name,
      slug: row.slug,
      roleName: row.roleName,
      deactivated: row.deactivatedAt !== null,
    });
    const toDeny = (row: (typeof denied)[number]): AccountDeny => ({
      ...row,
      organizationId: row.organizationId as OrganizationId,
    });

    return { ...account, memberships: joined.map(toMembership), denies: denied.map(toDeny) };
  }
}
