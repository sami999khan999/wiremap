import {
  boolean,
  check,
  index,
  type OrganizationId,
  pgTable,
  sql,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { users } from "./auth.schema.js";

// What an org has paid for, as keys. `is_unlimited` is every tenant key, resolved at read
// time rather than stored — see packages/permissions/docs/reference/entitlement-mask.md.
export const plans = pgTable("plans", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isUnlimited: boolean("is_unlimited").notNull().default(false),
  // Shipped by a migration, never deleted: `unlimited` is every existing org's plan.
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Raw strings, filtered through `PermissionRegistry.isKnown` before they are trusted.
export const planPermissions = pgTable(
  "plan_permissions",
  {
    planKey: text("plan_key")
      .notNull()
      .references(() => plans.key, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [uniqueIndex("plan_permissions_uq").on(t.planKey, t.permission)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").$type<OrganizationId>().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // The platform tier is an organization, so a platform grant rides the roles and
    // memberships every other grant does. Marked by the seed, never by a user.
    isPlatform: boolean("is_platform").notNull().default(false),
    // No action on delete: a plan in use cannot be deleted, which `delete-plan` also says.
    planKey: text("plan_key")
      .notNull()
      .default("unlimited")
      .references(() => plans.key),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The seed and every enroller resolve a slug with `.limit(1)`, so a duplicate is a
    // silent coin flip about which tenant a new member lands in.
    uniqueIndex("organizations_slug_uq").on(t.slug),
    // Partial, so it constrains only the true rows: at most one platform tier, and any
    // number of ordinary tenants. `resolvePlatformFor` resolves one row or none.
    uniqueIndex("organizations_platform_uq").on(t.isPlatform).where(sql`is_platform`),
    // For the foreign key, and for "is this plan in use" before a delete.
    index("organizations_plan_idx").on(t.planKey),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // `platform` appears only on the platform organization's own roles, where the seed
    // puts it. Nothing here validates that; the grant path is what refuses the rest.
    scope: text("scope", { enum: ["org", "goal", "platform"] }).notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roles_key_uq").on(t.organizationId, t.key),
    index("roles_organization_idx").on(t.organizationId),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    // A raw string. Validated through PermissionRegistry.isKnown() before it is trusted.
    permission: text("permission").notNull(),
  },
  (t) => [
    // Leads with the tenant, which also makes it the covering index for the
    // `organization_id` FK — a separate one would be a redundant prefix.
    uniqueIndex("role_permissions_uq").on(t.organizationId, t.roleId, t.permission),
    // Deleting a role cascades here, and the unique index above leads with the tenant,
    // so it cannot serve that scan.
    index("role_permissions_role_fk_idx").on(t.roleId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Declared here rather than in a hand-authored migration: drizzle-kit diffs this file
    // against the history, so a constraint it cannot see is one the next migration drops.
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // `no action` and not `restrict`: deleting a tenant cascades roles and memberships in
    // one statement, and `restrict` is checked before that statement finishes.
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Per membership: a tenant admin locks someone out of this tenant only. The lock on
    // every tenant at once is `users.suspended_at`, and it is the platform's.
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [
    // One membership per person per tenant, leading with the tenant column: `(user_id,
    // role_id)` let one person hold two roles and the switcher render a tenant twice.
    uniqueIndex("memberships_uq").on(t.organizationId, t.userId),
    // The sign-in path reads one membership by (org, user) and checks this column, so
    // it rides the unique index above rather than needing one of its own.
    index("memberships_active_idx").on(t.organizationId, t.deactivatedAt),
    // The `user_id` foreign key's own index: every by-user read starts from here.
    index("memberships_user_idx").on(t.userId),
    index("memberships_role_idx").on(t.roleId),
  ],
);

export const goalMembers = pgTable(
  "goal_members",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").notNull(),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("goal_members_uq").on(t.organizationId, t.goalId, t.userId, t.roleId),
    index("goal_members_user_idx").on(t.organizationId, t.userId),
    // The one above is tenant-scoped and a user delete is not, so the cascade needs
    // an index that leads with `user_id`.
    index("goal_members_user_fk_idx").on(t.userId),
    index("goal_members_goal_idx").on(t.goalId),
    index("goal_members_role_idx").on(t.roleId),
  ],
);

// Per-user overrides. effect='deny' beats every grant, including the wildcard.
export const permissionOverrides = pgTable(
  "permission_overrides",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id"), // null = org scope
    permission: text("permission").notNull(),
    effect: text("effect", { enum: ["grant", "deny"] }).notNull(),
    reason: text("reason"),
    // A grant widens and must lapse; a deny narrows and is safe to leave. The CHECKs below
    // hold both, so a hand-written grant with no end cannot exist.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // No foreign key: the audit trail names the actor, and a departed admin keeps no row.
    createdBy: uuid("created_by").$type<UserId>(),
    // `platform` is a deny the tier set. The org admin sees it and cannot clear it.
    authority: text("authority", { enum: ["org", "platform"] })
      .notNull()
      .default("org"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "permission_overrides_expiry_ck",
      sql`(${t.effect} = 'grant' and ${t.expiresAt} is not null) or (${t.effect} = 'deny' and ${t.expiresAt} is null)`,
    ),
    check("permission_overrides_reason_ck", sql`${t.effect} = 'deny' or ${t.reason} is not null`),
    check("permission_overrides_authority_ck", sql`${t.authority} = 'org' or ${t.effect} = 'deny'`),
    index("permission_overrides_user_idx").on(t.organizationId, t.userId),
    // Same split: the tenant-leading index answers the resolver, this one answers
    // the cascade from `users`.
    index("permission_overrides_user_fk_idx").on(t.userId),
    index("permission_overrides_goal_idx").on(t.goalId),
    // Two partial indexes, because NULLs are distinct over a nullable `goal_id`. `authority`
    // is in both, so a platform deny and an org row for the same key coexist.
    uniqueIndex("permission_overrides_org_uq")
      .on(t.organizationId, t.userId, t.permission, t.authority)
      .where(sql`${t.goalId} is null`),
    uniqueIndex("permission_overrides_goal_uq")
      .on(t.organizationId, t.userId, t.goalId, t.permission, t.authority)
      .where(sql`${t.goalId} is not null`),
    // The sweep's read. Partial: a deny never expires, so it is never a candidate.
    index("permission_overrides_expiry_idx").on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
  ],
);
