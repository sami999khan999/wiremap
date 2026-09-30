import type { OrganizationId, PaginationQuery, RoleId } from "../import.js";

// What a *role* grants, deliberately not a `CapabilitySet` — that is this plus goal
// memberships plus per-user overrides, and conflating them shows a wrong matrix.
export interface RoleRecord {
  readonly id: RoleId;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  // Mirrors `roles.scope`. `platform` appears only on the platform organization's own
  // roles; a tenant's role editor never offers it.
  readonly scope: "org" | "goal" | "platform";
  readonly isSystem: boolean;
  // Raw and unfiltered: a repository that dropped unknown keys would hide a rename
  // rather than surface it. The registry decides.
  readonly permissions: readonly string[];
  // How many of its members carry an exception. Filled by `list` alone — the one screen
  // that shows it — so a record read for an edit does not pay for it.
  readonly membersWithExceptions?: number;
}

export interface RolePage {
  readonly items: readonly RoleRecord[];
  readonly total: number;
}

// A repository port, so it lives with its subject rather than in `port/` — one file per
// slice there would grow forever.
export abstract class RoleRepository {
  // The tenant explicitly, never a `Principal`: a repository that could read one would
  // sooner or later decide something with it.
  public abstract list(organizationId: OrganizationId, page: PaginationQuery): Promise<RolePage>;

  // Under the tenant, so a role id from another organization is null — which is what
  // lets an invitation trust the id it was handed.
  public abstract findById(
    organizationId: OrganizationId,
    roleId: RoleId,
  ): Promise<RoleRecord | null>;

  // By the slug rather than the id, which is what `roles_key_uq` is on: a create checks
  // this before it inserts, so a duplicate is a CONFLICT and not a driver error.
  public abstract findByKey(
    organizationId: OrganizationId,
    key: string,
  ): Promise<RoleRecord | null>;

  // One write for the row *and* its grants, reconciled to `role.permissions`. Four
  // narrower methods would let a caller rename a role and leave its grants behind.
  public abstract save(organizationId: OrganizationId, role: RoleRecord): Promise<void>;

  // One grant, not the whole set. `save` reconciles against a list read before the
  // transaction, so two concurrent grants each wrote the set the other had not seen.
  public abstract savePermission(
    organizationId: OrganizationId,
    roleId: RoleId,
    permission: string,
  ): Promise<void>;

  public abstract deletePermission(
    organizationId: OrganizationId,
    roleId: RoleId,
    permission: string,
  ): Promise<void>;

  public abstract delete(organizationId: OrganizationId, roleId: RoleId): Promise<void>;

  // Memberships and goal memberships both reference `roles` with `on delete no action`,
  // so a delete of a role somebody holds is a driver error rather than a refusal.
  public abstract countAssignments(organizationId: OrganizationId, roleId: RoleId): Promise<number>;
}
