import {
  and,
  eq,
  type OrganizationId,
  PermissionRegistry,
  type Placement,
  sql,
  Uuid,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations, rolePermissions, roles } from "../schema/index.js";

// The one role the tier has. Holding every platform key rather than a list, because a
// platform key with nobody able to hold it is a screen nobody can open.
const KEY = "platform_admin";
const NAME = "Platform administrator";

// Idempotent, the same shape as `SystemRoleSeed`, and scoped to the organization marked
// `is_platform`. A deployment that has not marked one seeds nothing and says so.
export class PlatformRoleSeed extends BaseRepository {
  // RBAC.
  protected override readonly placement: Placement = "catalog";

  // Returns the organization it seeded, or null when none is marked — `pnpm db:seed`
  // marks one immediately before calling this, so null is a deployment that has not.
  public async run(): Promise<OrganizationId | null> {
    const found = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.isPlatform, true))
      .limit(1);

    const organizationId = found[0]?.id;
    if (!organizationId) return null;

    await this.db
      .insert(roles)
      .values({
        id: Uuid.v7(),
        organizationId,
        key: KEY,
        name: NAME,
        scope: "platform",
        isSystem: true,
      })
      .onConflictDoNothing({ target: [roles.organizationId, roles.key] });

    // Read back rather than trusting the id above, for the reason `SystemRoleSeed`
    // gives: a concurrent seed may have inserted the row a moment ago.
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, KEY)));

    const roleId = rows[0]?.id;
    if (!roleId) return organizationId;

    // Resolved at seed time, so a platform key added by a later phase reaches every
    // admin on the next deploy rather than on a grant somebody has to remember.
    const permissions = PermissionRegistry.instance.byScope("platform");

    if (permissions.length > 0) {
      await this.db
        .insert(rolePermissions)
        .values(permissions.map((permission) => ({ organizationId, roleId, permission })))
        .onConflictDoNothing();
    }

    await this.reconcile(organizationId, roleId, permissions);
    return organizationId;
  }

  // The half an insert cannot do. A platform key removed from the catalog stays granted
  // forever if the seed only ever adds — and this role is the one nothing else writes.
  private async reconcile(
    organizationId: OrganizationId,
    roleId: string,
    permissions: readonly string[],
  ): Promise<void> {
    const keep =
      permissions.length === 0
        ? sql`true`
        : sql`${rolePermissions.permission} not in (${sql.join(
            permissions.map((permission) => sql`${permission}`),
            sql`, `,
          )})`;

    await this.db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, organizationId),
          eq(rolePermissions.roleId, roleId),
          keep,
        ),
      );
  }
}
