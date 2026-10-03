import {
  and,
  eq,
  inArray,
  type OrganizationId,
  type PermissionKey,
  PermissionRegistry,
  type Placement,
  sql,
  Uuid,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { rolePermissions, roles } from "../schema/index.js";

interface SystemRole {
  readonly key: string;
  readonly name: string;
  readonly scope: "org" | "goal";
  readonly permissions: readonly PermissionKey[] | "all";
}

// Only `owner` gets every key: a role granting "everything in module X" keeps granting new
// things as X grows, which is how a reviewer acquires write access.

// Everyone who can hold a membership gets an inbox. Named once because `admin` and
// `member` grant the same three, and a second copy is how the two drift.
const NOTIFICATION: readonly PermissionKey[] = Object.freeze([
  "notification.inbox.read",
  "notification.inbox.update",
  "notification.preference.update",
]);

// Reading is everyone's; writing, publishing and arranging spaces is `admin`'s, the same
// line the roles themselves are drawn on.
const DOC_AUTHOR: readonly PermissionKey[] = Object.freeze([
  "doc.page.read",
  "doc.page.write",
  "doc.page.publish",
  "doc.space.manage",
]);

// What a project role holds, inside the project it is granted on. The org-level roles that
// list the same keys hold them in every project at once.
const PROJECT_ADMIN: readonly PermissionKey[] = Object.freeze([
  "project.graph.read",
  "project.scan.run",
  "project.settings.manage",
  "project.access.manage",
  "project.delete",
]);

// Frozen at module load rather than left a `static readonly`, which freezes the binding
// and not the array — the shape `docs/ai/rules/classes.md` bans.
const ROLES: readonly SystemRole[] = Object.freeze([
  { key: "owner", name: "Owner", scope: "org", permissions: "all" },
  {
    key: "admin",
    name: "Administrator",
    scope: "org",
    permissions: [
      "rbac.role.read",
      "rbac.role.manage",
      // The drift reviewer's view. Writing exceptions stays with whoever may grant.
      "rbac.override.read",
      "member.read",
      "member.invite",
      // Wiremap: shaping the organization's teams, auto-join domains and name, and reading
      // its audit trail. Handing it over and deleting it stay the owner's.
      "member.team.manage",
      "member.domain.manage",
      "organization.profile.update",
      "audit.log.read",
      "project.create",
      "project.access.overview",
      ...PROJECT_ADMIN,
      ...NOTIFICATION,
      ...DOC_AUTHOR,
    ],
  },
  {
    key: "member",
    name: "Member",
    scope: "org",
    // A member may start a project, and administers the ones they start.
    permissions: ["member.read", ...NOTIFICATION, "doc.page.read", "project.create"],
  },
  // Wiremap's read-only seat: the same organization-wide keys as `member` today. The two
  // part at projects, where a viewer is capped at reading.
  {
    key: "viewer",
    name: "Viewer",
    scope: "org",
    permissions: ["member.read", ...NOTIFICATION, "doc.page.read"],
  },
  // The three project roles: `goal`-scoped, named by a project's grants and default role.
  { key: "project_admin", name: "Project admin", scope: "goal", permissions: PROJECT_ADMIN },
  {
    key: "project_editor",
    name: "Project editor",
    scope: "goal",
    permissions: ["project.graph.read", "project.scan.run"],
  },
  {
    key: "project_viewer",
    name: "Project viewer",
    scope: "goal",
    permissions: ["project.graph.read"],
  },
  // Never `guest`: an inbox is something you hold, and a guest holds no memberships to
  // be notified about.
  { key: "guest", name: "Guest", scope: "org", permissions: [] },
]);

const KEYS: readonly string[] = Object.freeze(ROLES.map((definition) => definition.key));

// What `"all"` resolves to. **A tenant owner is not a platform admin**, and
// `reconcile()` takes back any platform key an earlier deploy's `all` handed out.
const TENANT_KEYS: readonly PermissionKey[] = Object.freeze(
  PermissionRegistry.instance.all().filter((key) => {
    return PermissionRegistry.instance.scopeOf(key) !== "platform";
  }),
);

export class SystemRoleSeed extends BaseRepository {
  // RBAC.
  protected override readonly placement: Placement = "catalog";

  // Idempotent: safe to run on every deploy. Per organization, because system roles
  // are rows in a tenant's table rather than global constants.
  public async run(organizationId: OrganizationId): Promise<void> {
    // Write first, read after: `on conflict do nothing` makes one statement correct for a
    // tenant that has these rows and for one that does not, which a per-role check is not.
    await this.db
      .insert(roles)
      .values(
        ROLES.map((definition) => ({
          id: Uuid.v7(),
          organizationId,
          key: definition.key,
          name: definition.name,
          scope: definition.scope,
          isSystem: true,
        })),
      )
      .onConflictDoNothing({ target: [roles.organizationId, roles.key] });

    // One `IN` for all four ids, including any a concurrent seed inserted a moment ago —
    // which is why this reads the table rather than trusting the ids generated above.
    const rows = await this.db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), inArray(roles.key, KEYS)));

    const idByKey = new Map(rows.map((row) => [row.key, row.id]));

    const grants = ROLES.flatMap((definition) => {
      const roleId = idByKey.get(definition.key);
      if (!roleId) return [];

      // Resolved at seed time, so every permission a feature adds reaches owners on
      // the next deploy. That is why the seed must re-run rather than run once.
      const permissions = definition.permissions === "all" ? TENANT_KEYS : definition.permissions;

      return permissions.map((permission) => ({ organizationId, roleId, permission }));
    });

    if (grants.length === 0) return;

    await this.db.insert(rolePermissions).values(grants).onConflictDoNothing();

    // The half an insert cannot do. A permission removed from the catalog, or dropped
    // from a role's list, stays granted forever if the seed only ever adds.
    await this.reconcile(organizationId, [...idByKey.values()], grants);
  }

  // Scoped to the seeded roles, which is what makes a blanket delete safe: `RoleRules`
  // refuses to edit a system role, so nothing but this seed writes their grants.
  private async reconcile(
    organizationId: OrganizationId,
    roleIds: readonly string[],
    grants: readonly { readonly roleId: string; readonly permission: string }[],
  ): Promise<void> {
    const pairs = sql.join(
      grants.map((grant) => sql`(${grant.roleId}, ${grant.permission})`),
      sql`, `,
    );

    await this.db.delete(rolePermissions).where(
      and(
        eq(rolePermissions.organizationId, organizationId),
        inArray(rolePermissions.roleId, [...roleIds]),
        // A row-value `not in`, so one statement covers every role — including `guest`,
        // whose whole set is "none" and whose stale rows are therefore all of them.
        sql`(${rolePermissions.roleId}, ${rolePermissions.permission}) not in (${pairs})`,
      ),
    );
  }
}
