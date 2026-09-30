import {
  and,
  asc,
  ConflictError,
  count,
  eq,
  inArray,
  not,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  type RoleId,
  type RolePage,
  type RoleRecord,
  type RoleRepository,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { goalMembers, memberships, rolePermissions, roles } from "../schema/index.js";

export class PgRoleRepository extends BaseRepository implements RoleRepository {
  // RBAC.
  protected override readonly placement: Placement = "catalog";

  // Three queries, fixed — never one per role: the grants come for the whole page with a
  // single `IN`, because an N+1 here is invisible at four roles.
  public async list(organizationId: OrganizationId, page: PaginationQuery): Promise<RolePage> {
    const rows = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        scope: roles.scope,
        isSystem: roles.isSystem,
        // Members of this role with at least one live override, correlated so the list stays
        // three statements. Named in full: drizzle writes an unqualified column here.
        membersWithExceptions: sql<number>`(select count(*)::int from memberships m
          where m.organization_id = "roles"."organization_id"
            and m.role_id = "roles"."id"
            and exists (select 1 from permission_overrides po
              where po.organization_id = m.organization_id
                and po.user_id = m.user_id
                and (po.expires_at is null or po.expires_at > now())))`,
      })
      .from(roles)
      // Every read narrows by tenant. There is no code path here that could omit it.
      .where(eq(roles.organizationId, organizationId))
      // By creation, so a page boundary is stable: ordering by name reshuffles the moment
      // somebody renames a role mid-pagination.
      .orderBy(asc(roles.createdAt))
      .limit(page.limit)
      .offset(page.offset);

    // The tenant's total, not the page's, which is why it cannot come from `rows.length`.
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(roles)
      .where(eq(roles.organizationId, organizationId));

    const ids = rows.map((row) => row.id);
    const grants =
      ids.length === 0
        ? []
        : await this.db
            .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(
              // By role *and* by tenant: the second predicate costs an index lookup and
              // removes any chance of a cross-tenant row arriving through a role id.
              sql`${inArray(rolePermissions.roleId, ids)} and ${eq(rolePermissions.organizationId, organizationId)}`,
            );

    const byRole = new Map<string, string[]>();
    for (const grant of grants) {
      const bucket = byRole.get(grant.roleId);
      if (bucket) bucket.push(grant.permission);
      else byRole.set(grant.roleId, [grant.permission]);
    }

    const items: RoleRecord[] = rows.map((row) => ({
      id: row.id as RoleId,
      key: row.key,
      name: row.name,
      description: row.description,
      scope: row.scope,
      isSystem: row.isSystem,
      // Sorted, so two runs against the same data produce the same response.
      permissions: (byRole.get(row.id) ?? []).sort(),
      membersWithExceptions: row.membersWithExceptions,
    }));

    return { items, total: counted?.total ?? 0 };
  }

  // By the slug `roles_key_uq` is on, so a create can refuse a duplicate rather than
  // let the driver raise one.
  public async findByKey(organizationId: OrganizationId, key: string): Promise<RoleRecord | null> {
    const [row] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, key)))
      .limit(1);

    return row ? this.findById(organizationId, row.id as RoleId) : null;
  }

  // `on conflict do nothing`, so a grant already held is a no-op rather than a
  // duplicate-key error — two callers race and both may be right.
  public async savePermission(
    organizationId: OrganizationId,
    roleId: RoleId,
    permission: string,
  ): Promise<void> {
    await this.db
      .insert(rolePermissions)
      .values({ organizationId, roleId, permission })
      .onConflictDoNothing();
  }

  public async deletePermission(
    organizationId: OrganizationId,
    roleId: RoleId,
    permission: string,
  ): Promise<void> {
    await this.db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, organizationId),
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permission, permission),
        ),
      );
  }

  // The row and its grants in one call, reconciled rather than replaced: deleting every
  // permission and re-inserting would churn the index on a rename.
  public async save(organizationId: OrganizationId, role: RoleRecord): Promise<void> {
    // Update first, insert only if it matched nothing. One `on conflict (id)` cannot do
    // this: an existing row trips `roles_key_uq` too, and only the arbiter is caught.
    const updated = await this.db
      .update(roles)
      .set({ name: role.name, description: role.description })
      .where(and(eq(roles.organizationId, organizationId), eq(roles.id, role.id)));

    if ((updated.rowCount ?? 0) === 0) {
      const inserted = await this.db
        .insert(roles)
        .values({
          id: role.id,
          organizationId,
          key: role.key,
          name: role.name,
          description: role.description,
          scope: role.scope,
          isSystem: role.isSystem,
        })
        // The use-case refuses a duplicate key before it reaches here; this closes the
        // race between that check and this insert, with the code it would have thrown.
        .onConflictDoNothing({ target: [roles.organizationId, roles.key] });

      if ((inserted.rowCount ?? 0) === 0) throw new ConflictError("role", "duplicate");
    }

    const keep = [...role.permissions];

    await this.db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, organizationId),
          eq(rolePermissions.roleId, role.id),
          keep.length === 0 ? undefined : not(inArray(rolePermissions.permission, keep)),
        ),
      );

    if (keep.length > 0) {
      await this.db
        .insert(rolePermissions)
        .values(keep.map((permission) => ({ organizationId, roleId: role.id, permission })))
        .onConflictDoNothing();
    }
  }

  // The grants go with the row: `role_permissions.role_id` cascades, so this is one
  // statement and the second table is the database's problem.
  public async delete(organizationId: OrganizationId, roleId: RoleId): Promise<void> {
    await this.db
      .delete(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.id, roleId)));
  }

  // Both tables that reference `roles` with `on delete no action`, summed: either one
  // non-empty makes a delete a driver error rather than a refusal the UI can render.
  public async countAssignments(organizationId: OrganizationId, roleId: RoleId): Promise<number> {
    const [held] = await this.db
      .select({ total: count() })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.roleId, roleId)));

    const [scoped] = await this.db
      .select({ total: count() })
      .from(goalMembers)
      .where(and(eq(goalMembers.organizationId, organizationId), eq(goalMembers.roleId, roleId)));

    return (held?.total ?? 0) + (scoped?.total ?? 0);
  }

  // Two queries for one row: `RoleRecord` carries its grants, and a thinner record type
  // would be a second shape to keep in step.
  public async findById(
    organizationId: OrganizationId,
    roleId: RoleId,
  ): Promise<RoleRecord | null> {
    const [row] = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        scope: roles.scope,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.id, roleId)))
      .limit(1);

    if (!row) return null;

    const grants = await this.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.organizationId, organizationId)),
      );

    return {
      id: row.id as RoleId,
      key: row.key,
      name: row.name,
      description: row.description,
      scope: row.scope,
      isSystem: row.isSystem,
      permissions: grants.map((grant) => grant.permission).sort(),
    };
  }
}
