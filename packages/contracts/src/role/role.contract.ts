import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

export class RoleContract {
  private constructor() {}

  // Mirrors `roles.scope`: org-scoped grants apply tenant-wide, goal-scoped only inside
  // the goals a membership names, platform-scoped only on the tier's own roles.
  public static readonly scope = z.enum(["org", "goal", "platform"]);

  // Narrower than what a role *is*. A platform-scoped role is `PlatformRoleSeed`'s;
  // nothing creates one over the wire, in any tenant, ever.
  public static readonly creatableScope = z.enum(["org", "goal"]);

  public static readonly entity = z.object({
    id: Identifiers.roleId,
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    scope: RoleContract.scope,
    // Seeded by `SystemRoleSeed` and re-seeded on every deploy. Surfaced because a UI
    // that lets someone edit `owner` is a UI that lets someone lock themselves out.
    isSystem: z.boolean(),
    // Raw strings, filtered by `PermissionRegistry.isKnown()` at the point of use
    // rather than here: a renamed permission must not make this endpoint throw.
    permissions: z.array(z.string()).readonly(),
    // Filled by the list alone; a single role read for an edit does not count it.
    membersWithExceptions: z.number().int().nonnegative().optional(),
  });

  public static readonly listQuery = Pagination.query;

  // The wire shape of `CapabilitySetDto`, declared here rather than imported: a
  // contract is the boundary's own statement of the shape.
  public static readonly scopedSet = z.object({
    grants: z.array(z.string()).readonly(),
    denies: z.array(z.string()).readonly(),
  });

  public static readonly capabilities = z.object({
    wildcard: z.boolean(),
    org: RoleContract.scopedSet,
    // Keyed by goal id. A record rather than an array, because that is what
    // `CapabilitySet` indexes and a list would be re-keyed on every read.
    goals: z.record(z.string(), RoleContract.scopedSet),
    // Optional for the reason the DTO gives: a snapshot serialised before this axis
    // existed degrades to "no platform rights" rather than failing validation.
    platform: RoleContract.scopedSet.optional(),
  });

  public static readonly inspect = z.object({ userId: Identifiers.userId });

  // One live override, as the explanation lists it. Raw strings, like a role's grants.
  public static readonly override = z.object({
    id: z.string(),
    permission: z.string(),
    effect: z.enum(["grant", "deny"]),
    goalId: z.string().nullable(),
    authority: z.enum(["org", "platform"]),
    reason: z.string().nullable(),
    expiresAt: z.date().nullable(),
  });

  // What an answer is made of: role grants, live overrides, and the plan's ceiling as the
  // keys it lets through. The inspector names each key's source from this.
  public static readonly explanation = z.object({
    roleGrants: z.array(z.string()).readonly(),
    goalGrants: z.record(z.string(), z.array(z.string()).readonly()),
    overrides: z.array(RoleContract.override).readonly(),
    entitled: z.array(z.string()).readonly(),
  });

  // `capabilities` stays the shape it was; the explanation rides beside it, not inside.
  public static readonly effective = z.object({
    capabilities: RoleContract.capabilities,
    explanation: RoleContract.explanation,
  });

  // Strings, not the permission union: the list is compared against role rows, which are
  // raw strings too, and a key the catalog dropped simply never matches.
  public static readonly entitlement = z.object({ keys: z.array(z.string()).readonly() });

  // The stable handle a rule can name — `MemberRules.OWNER_KEY` is a string comparison
  // against this column, so it is a slug and it never changes after creation.
  public static readonly key = z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/);

  public static readonly create = z.object({
    key: RoleContract.key,
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullable().default(null),
    scope: RoleContract.creatableScope,
  });

  // No `key` and no `scope`: both are what other rows point at by meaning, and an
  // editable key turns every `roleKey === "owner"` test into a race with a rename.
  public static readonly update = z.object({
    roleId: Identifiers.roleId,
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullable().default(null),
  });

  public static readonly remove = z.object({ roleId: Identifiers.roleId });

  // The permission stays a raw string here, as `entity.permissions` does. The use-case
  // rejects an unknown one against the registry, which is where a real key list lives.
  public static readonly changePermission = z.object({
    roleId: Identifiers.roleId,
    permission: z.string().min(1).max(120),
  });
}

export type RoleDto = z.infer<typeof RoleContract.entity>;
export type CapabilitiesDto = z.infer<typeof RoleContract.capabilities>;
export type OverrideDto = z.infer<typeof RoleContract.override>;
export type ExplanationDto = z.infer<typeof RoleContract.explanation>;
export type EffectiveDto = z.infer<typeof RoleContract.effective>;
export type InspectEffectiveInput = z.infer<typeof RoleContract.inspect>;
export type CreateRoleInput = z.infer<typeof RoleContract.create>;
export type UpdateRoleInput = z.infer<typeof RoleContract.update>;
export type DeleteRoleInput = z.infer<typeof RoleContract.remove>;
export type ChangeRolePermissionInput = z.infer<typeof RoleContract.changePermission>;
export type RoleEntitlementDto = z.infer<typeof RoleContract.entitlement>;
