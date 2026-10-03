// Where a table lives. Every table has exactly one, and the three lists below cover
// every table in `pg/schema/` once — see docs/opinions/data-and-scale.md, decision D14.
export type Placement = "catalog" | "local" | "routed";

// The tables a principal is built from before a key is known, plus RBAC, the two
// tenant-less lookups, the archive index and the platform policy rows.
const CATALOG = Object.freeze([
  "users",
  "accounts",
  "sessions",
  "verifications",
  "two_factors",
  "organizations",
  "memberships",
  "roles",
  "role_permissions",
  "goal_members",
  "permission_overrides",
  "invitations",
  "api_keys",
  "shard_assignments",
  // Claimed inside the founder's catalog transaction, so it lives where that runs.
  "spare_tenants",
  // The archive index is read before any shard is known, and `17.6`'s sweep reads one
  // place.
  "partition_archive",
  // Deployment-wide policy, all four read by the worker before it knows a tenant.
  // Later than decision D14, which predates Phases 19 and 20.
  "platform_policy",
  // Deployment-wide switches, read before a request knows its shard.
  "feature_flags",
  "feature_flag_organizations",
  // Entitlement: read inside capability resolution, which runs before a shard is known.
  "plans",
  "plan_permissions",
  "entitlement_adjustments",
  "disabled_modules",
  // Who outside the platform may read a granted doc space. Read before a request is
  // placed, and it names organizations, people and plans across every tenant.
  "doc_space_grants",
  // Wiremap: looked up by token or by email domain with no tenant in hand, and teams sit
  // beside `goal_members` because the capability read joins them.
  "invitation_links",
  "organization_domains",
  "teams",
  "team_members",
  // Projects are access metadata, resolved with capabilities; their scans and graphs are not.
  "projects",
  "project_repositories",
  "project_grants",
  "github_installations",
  // Configuration, read beside the organization.
  "organization_ai",
] as const);

// Present on every physical database and written in whichever transaction is open.
// Two tables, and both have writers the cross-tenant loops already cover.
const LOCAL = Object.freeze(["activity_log", "outbox_event"] as const);

const CATALOG_SET: ReadonlySet<string> = new Set(CATALOG);
const LOCAL_SET: ReadonlySet<string> = new Set(LOCAL);

// The organization is the shard — decision D28, so there is no virtual shard number
// between the two. Branded, so a table name or a user id cannot be passed as one.
export type ShardKey = string & { readonly __brand: "ShardKey" };

export class Shard {
  private constructor() {}

  // Rejects empty, because an empty key resolves to whichever node the directory
  // happens to answer with and would place a tenant's rows silently.
  public static keyOf(raw: string): ShardKey {
    const key = raw.trim();
    if (key.length === 0) throw new Error("A shard key cannot be empty.");
    return key as ShardKey;
  }
}

// Every table this system places. `routed` is the default rather than a third list:
// everything a tenant produces is routed, and a new slice's table needs no edit here.
export class TablePlacement {
  private constructor() {}

  public static readonly CATALOG = CATALOG;
  public static readonly LOCAL = LOCAL;

  public static of(table: string): Placement {
    if (CATALOG_SET.has(table)) return "catalog";
    if (LOCAL_SET.has(table)) return "local";
    return "routed";
  }
}
