import {
  and,
  type CapabilityExplanation,
  type CapabilityRepository,
  CapabilityResolution,
  CapabilitySet,
  EntitlementMask,
  eq,
  gt,
  isNull,
  type OrganizationId,
  or,
  type PermissionKey,
  PermissionRegistry,
  type Placement,
  ProjectRules,
  sql,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import {
  disabledModules,
  entitlementAdjustments,
  memberships,
  organizations,
  permissionOverrides,
  planPermissions,
  plans,
  rolePermissions,
} from "../schema/index.js";

export class PgCapabilityRepository extends BaseRepository implements CapabilityRepository {
  // RBAC — read on every request, before a key is known.
  protected override readonly placement: Placement = "catalog";

  // Org grants + goal grants + per-user overrides, deny winning, then the plan's mask.
  // A fold over `explainFor`, so the inspector's "why" and the gate's answer cannot differ.
  public async resolveFor(organizationId: OrganizationId, userId: UserId): Promise<CapabilitySet> {
    return CapabilityResolution.fold(await this.explainFor(organizationId, userId));
  }

  // Four targeted queries, not one join: the join is a cartesian product needing dedup.
  public async explainFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<CapabilityExplanation> {
    const orgRows = await this.db
      .select({ permission: rolePermissions.permission })
      .from(memberships)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, memberships.roleId))
      // Deactivated grants nothing. Defence in depth: `PrincipalBuilder` already
      // refuses the session, and this is what a bypass of it would still hit.
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          isNull(memberships.deactivatedAt),
        ),
      );

    // Goal grants from `goal_members` and from projects (org default, direct, team) in one
    // statement. Every role adds its keys, which is "highest wins" as roles nest; viewers capped.
    const goalRows = (
      await this.db.execute<{ goal_id: string; permission: string }>(sql`
        with me as (
          select r.key as org_role
          from memberships m
          join roles r on r.id = m.role_id
          where m.organization_id = ${organizationId} and m.user_id = ${userId}
            and m.deactivated_at is null
        ),
        reach as (
          select p.id as goal_id, p.default_role as role
          from projects p
          where p.organization_id = ${organizationId} and p.visibility = 'org'
            and p.deleted_at is null
          union
          select g.project_id, g.role
          from project_grants g
          join projects p on p.id = g.project_id and p.deleted_at is null
          where g.organization_id = ${organizationId} and g.user_id = ${userId}
          union
          select g.project_id, g.role
          from project_grants g
          join team_members t
            on t.organization_id = g.organization_id and t.team_id = g.team_id
          join projects p on p.id = g.project_id and p.deleted_at is null
          where g.organization_id = ${organizationId} and t.user_id = ${userId}
        )
        select distinct reach.goal_id::text as goal_id, rp.permission
        from reach
        cross join me
        join roles r on r.organization_id = ${organizationId}
          and r.key = case when me.org_role = ${ProjectRules.READ_ONLY_ORG_ROLE}
            then 'project_viewer' else reach.role end
        join role_permissions rp on rp.role_id = r.id
        union
        select gm.goal_id::text, rp.permission
        from goal_members gm
        join role_permissions rp on rp.role_id = gm.role_id
        where gm.organization_id = ${organizationId} and gm.user_id = ${userId}
      `)
    ).rows.map((row) => ({ goalId: row.goal_id, permission: row.permission }));

    // Expired rows are filtered here, which is the real mechanism: a cached set can outlive
    // an expiry by up to the TTL, and the sweep only tidies. A deny never expires.
    const overrideRows = await this.db
      .select({
        id: permissionOverrides.id,
        permission: permissionOverrides.permission,
        effect: permissionOverrides.effect,
        goalId: permissionOverrides.goalId,
        authority: permissionOverrides.authority,
        reason: permissionOverrides.reason,
        expiresAt: permissionOverrides.expiresAt,
      })
      .from(permissionOverrides)
      .where(
        and(
          eq(permissionOverrides.organizationId, organizationId),
          eq(permissionOverrides.userId, userId),
          or(isNull(permissionOverrides.expiresAt), gt(permissionOverrides.expiresAt, sql`now()`)),
        ),
      );

    const goalGrants: Record<string, string[]> = {};
    for (const row of goalRows) {
      const bucket = goalGrants[row.goalId] ?? [];
      bucket.push(row.permission);
      goalGrants[row.goalId] = bucket;
    }

    return {
      roleGrants: orgRows.map((row) => row.permission),
      goalGrants,
      overrides: overrideRows,
      entitlement: await this.entitlementFor(organizationId),
    };
  }

  // One statement: four index lookups, tagged by kind and unioned. A join of the four would
  // multiply rows; a union is four small reads in one round trip.
  public async entitlementFor(organizationId: OrganizationId): Promise<EntitlementMask> {
    const planRows = this.db
      .select({ kind: sql<string>`'plan'`.as("kind"), value: planPermissions.permission })
      .from(organizations)
      .innerJoin(planPermissions, eq(planPermissions.planKey, organizations.planKey))
      .where(eq(organizations.id, organizationId));

    const unlimited = this.db
      .select({ kind: sql<string>`'unlimited'`.as("kind"), value: plans.key })
      .from(organizations)
      .innerJoin(plans, eq(plans.key, organizations.planKey))
      .where(and(eq(organizations.id, organizationId), eq(plans.isUnlimited, true)));

    // Expired rows are ignored here, which is the real mechanism; the sweep only tidies.
    const adjustments = this.db
      .select({
        kind: sql<string>`${entitlementAdjustments.effect}`.as("kind"),
        value: entitlementAdjustments.permission,
      })
      .from(entitlementAdjustments)
      .where(
        and(
          eq(entitlementAdjustments.organizationId, organizationId),
          or(
            isNull(entitlementAdjustments.expiresAt),
            gt(entitlementAdjustments.expiresAt, sql`now()`),
          ),
        ),
      );

    const disabled = this.db
      .select({ kind: sql<string>`'disabled'`.as("kind"), value: disabledModules.module })
      .from(disabledModules);

    const rows = await planRows.unionAll(unlimited).unionAll(adjustments).unionAll(disabled);

    const of = (kind: string) => rows.filter((row) => row.kind === kind).map((row) => row.value);
    return EntitlementMask.from({
      plan: rows.some((row) => row.kind === "unlimited") ? "all" : of("plan"),
      added: of("add"),
      removed: of("remove"),
      disabledModules: of("disabled"),
    });
  }

  // Two queries against the one organization marked `is_platform`, filtered to keys the
  // registry calls platform-scoped — a tenant key granted there reaches no axis at all.
  public async resolvePlatformFor(userId: UserId): Promise<CapabilitySet> {
    const registry = PermissionRegistry.instance;
    const grants = new Set<PermissionKey>();
    const denies = new Set<PermissionKey>();

    const grantRows = await this.db
      .select({ permission: rolePermissions.permission })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, memberships.roleId))
      // Deactivated grants nothing, here most of all: removing someone's platform rights
      // is deactivating their membership in the tier.
      .where(
        and(
          eq(organizations.isPlatform, true),
          eq(memberships.userId, userId),
          isNull(memberships.deactivatedAt),
        ),
      );

    for (const row of grantRows) {
      if (registry.isKnown(row.permission) && registry.scopeOf(row.permission) === "platform") {
        grants.add(row.permission);
      }
    }

    // A platform deny for one user, on the tier's own organization. `goal_id` is ignored:
    // a platform key has no goal level, and a row carrying one is a mis-write.
    const overrideRows = await this.db
      .select({
        permission: permissionOverrides.permission,
        effect: permissionOverrides.effect,
      })
      .from(permissionOverrides)
      .innerJoin(organizations, eq(organizations.id, permissionOverrides.organizationId))
      .where(
        and(
          eq(organizations.isPlatform, true),
          eq(permissionOverrides.userId, userId),
          // Live only, as the tenant query reads them: an expired exception grants nothing.
          or(isNull(permissionOverrides.expiresAt), gt(permissionOverrides.expiresAt, sql`now()`)),
        ),
      );

    for (const row of overrideRows) {
      if (!registry.isKnown(row.permission)) continue;
      if (registry.scopeOf(row.permission) !== "platform") continue;
      if (row.effect === "deny") denies.add(row.permission);
      else grants.add(row.permission);
    }

    return CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: [...grants], denies: [...denies] },
    });
  }
}
