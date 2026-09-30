import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export class PlatformContract {
  private constructor() {}

  // Three states per dependency, and the third is the one that matters: `null` is "this
  // deployment runs none", which is neither healthy nor degraded.
  public static readonly dependency = z.boolean().nullable();

  public static readonly health = z.object({
    healthy: z.boolean(),
    database: z.boolean(),
    cache: z.boolean(),
    queue: z.boolean(),
    analytics: PlatformContract.dependency,
    realtime: PlatformContract.dependency,
  });

  public static readonly organization = z.object({
    id: Identifiers.organizationId,
    slug: z.string().min(1),
    name: z.string().min(1),
  });

  // Node standbys folded into one reading, `null` when the deployment runs none — `25.1`.
  // `lagSeconds` is null exactly when a standby could not be asked.
  public static readonly replica = z.object({
    healthy: z.boolean(),
    lagSeconds: z.number().nullable(),
    readsEnabled: z.boolean(),
  });

  public static readonly status = z.object({
    organization: PlatformContract.organization,
    health: PlatformContract.health,
    replica: PlatformContract.replica.nullable(),
  });

  // The slug travels with the id and the server compares them. A confirmation only
  // the browser checks is a confirmation the API does not have.
  public static readonly tenantDelete = z.object({
    organizationId: Identifiers.organizationId,
    slug: z.string().min(1).max(64),
  });

  public static readonly replicaToggle = z.object({ enabled: z.boolean() });

  // The key is a string, not the flag union: a row can outlive the code that declared it,
  // and the list shows that row as orphaned rather than failing to parse it.
  public static readonly flagTarget = z.object({
    organizationId: Identifiers.organizationId,
    slug: z.string(),
  });

  public static readonly flag = z.object({
    key: z.string(),
    owner: z.string().nullable(),
    expiresOn: z.string().nullable(),
    description: z.string().nullable(),
    isEnabled: z.boolean(),
    targets: z.array(PlatformContract.flagTarget),
    orphaned: z.boolean(),
    updatedAt: z.date().nullable(),
  });

  public static readonly flagList = z.object({ items: z.array(PlatformContract.flag) });

  public static readonly flagToggle = z.object({
    key: z.string().trim().min(1).max(128),
    enabled: z.boolean(),
  });

  // Entitlement. Keys are strings rather than the permission union: a plan row can
  // outlive a key the catalog dropped, and the screen shows it rather than failing.
  public static readonly plan = z.object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    isUnlimited: z.boolean(),
    isSystem: z.boolean(),
    permissions: z.array(z.string()).readonly(),
    organizations: z.number().int().nonnegative(),
  });

  public static readonly planList = z.object({
    items: z.array(PlatformContract.plan).readonly(),
    defaultPlanKey: z.string(),
  });

  public static readonly planSave = z.object({
    key: z.string().trim().min(1).max(63),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    permissions: z.array(z.string().min(1).max(128)).max(500),
  });

  public static readonly planRef = z.object({ key: z.string().trim().min(1).max(63) });

  // An id or a slug, whichever the operator is holding, as `tenantLookup` takes it.
  public static readonly organizationRef = z.object({
    organization: z.string().trim().min(1).max(128),
  });

  public static readonly adjustmentEffect = z.enum(["add", "remove"]);

  public static readonly adjustment = z.object({
    organizationId: Identifiers.organizationId,
    permission: z.string(),
    effect: PlatformContract.adjustmentEffect,
    reason: z.string(),
    expiresAt: z.date().nullable(),
    createdAt: z.date(),
  });

  public static readonly roleCoverage = z.object({
    key: z.string(),
    name: z.string(),
    listed: z.number().int().nonnegative(),
    entitled: z.number().int().nonnegative(),
  });

  public static readonly organizationEntitlement = z.object({
    organization: z.object({ id: Identifiers.organizationId, slug: z.string(), name: z.string() }),
    planKey: z.string(),
    adjustments: z.array(PlatformContract.adjustment).readonly(),
    entitled: z.array(z.string()).readonly(),
    roles: z.array(PlatformContract.roleCoverage).readonly(),
  });

  public static readonly planAssign = z.object({
    organization: z.string().trim().min(1).max(128),
    planKey: z.string().trim().min(1).max(63),
  });

  // `coerce`, because a date arrives as a string over the OpenAPI adapter. Null is permanent.
  public static readonly adjustmentSave = z.object({
    organization: z.string().trim().min(1).max(128),
    permission: z.string().trim().min(1).max(128),
    effect: PlatformContract.adjustmentEffect,
    reason: z.string().trim().min(1).max(500),
    expiresAt: z.coerce.date().nullable(),
  });

  // Every key the closure reached, so the screen can say "also removed: member.invite".
  public static readonly adjusted = z.object({ permissions: z.array(z.string()).readonly() });

  public static readonly adjustmentClear = z.object({
    organization: z.string().trim().min(1).max(128),
    permission: z.string().trim().min(1).max(128),
  });

  // ── accounts (`AX6.6`) ─────────────────────────────────────────────────────
  public static readonly accountQuery = z.object({ email: z.string().trim().email().max(254) });

  public static readonly accountMembership = z.object({
    organizationId: Identifiers.organizationId,
    name: z.string(),
    slug: z.string(),
    roleName: z.string(),
    deactivated: z.boolean(),
  });

  public static readonly accountDeny = z.object({
    id: z.string(),
    organizationId: Identifiers.organizationId,
    permission: z.string(),
    reason: z.string().nullable(),
    createdAt: z.date(),
  });

  public static readonly account = z.object({
    userId: Identifiers.userId,
    email: z.string(),
    name: z.string(),
    suspendedAt: z.date().nullable(),
    memberships: z.array(PlatformContract.accountMembership).readonly(),
    denies: z.array(PlatformContract.accountDeny).readonly(),
  });

  // A reason on both: each is audited in every tenant the account belongs to, and an
  // admin there reads why before they read anything else.
  public static readonly accountSuspension = z.object({
    userId: Identifiers.userId,
    reason: z.string().trim().min(1).max(500),
  });

  public static readonly accountDenySave = z.object({
    userId: Identifiers.userId,
    organizationId: Identifiers.organizationId,
    permission: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(500),
  });

  public static readonly accountDenyClear = z.object({
    organizationId: Identifiers.organizationId,
    overrideId: z.string().min(1).max(64),
  });

  public static readonly moduleSwitch = z.object({
    module: z.string(),
    enabled: z.boolean(),
    reason: z.string().nullable(),
    disabledAt: z.date().nullable(),
  });

  public static readonly moduleSwitchList = z.object({
    items: z.array(PlatformContract.moduleSwitch).readonly(),
  });

  // The reason is required to switch off; the use-case says so, with a field to point at.
  public static readonly moduleSwitchUpdate = z.object({
    module: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
    reason: z.string().max(500),
  });

  // An id or a slug, whichever the operator is holding, as `tenantLookup` takes it.
  public static readonly flagTargetToggle = z.object({
    key: z.string().trim().min(1).max(128),
    organization: z.string().trim().min(1).max(128),
    enabled: z.boolean(),
  });

  public static readonly tenantExport = z.object({
    organizationId: Identifiers.organizationId,
  });

  public static readonly exportRequested = z.object({
    jobId: z.string().min(1),
  });

  public static readonly tenantExportObject = z.object({
    key: z.string().min(1),
    day: z.string(),
    // Presigned and short-lived. Never a permanent public URL, which is why this is
    // read on every render rather than stored.
    url: z.string().min(1),
  });

  // A job id, not a tally. The delete archives every month and drops seven partitions
  // per tenant, which is minutes for a large one — too long to hold a request open.
  public static readonly deleteRequested = z.object({
    jobId: z.string().min(1),
  });
}

export type PlatformHealthDto = z.infer<typeof PlatformContract.health>;
export type TenantDeleteInput = z.infer<typeof PlatformContract.tenantDelete>;
export type ReplicaDto = z.infer<typeof PlatformContract.replica>;
export type ReplicaToggleInput = z.infer<typeof PlatformContract.replicaToggle>;
export type FlagDto = z.infer<typeof PlatformContract.flag>;
export type PlanDto = z.infer<typeof PlatformContract.plan>;
export type PlanListDto = z.infer<typeof PlatformContract.planList>;
export type PlanSaveInput = z.infer<typeof PlatformContract.planSave>;
export type PlanRefInput = z.infer<typeof PlatformContract.planRef>;
export type AdjustmentDto = z.infer<typeof PlatformContract.adjustment>;
export type OrganizationEntitlementDto = z.infer<typeof PlatformContract.organizationEntitlement>;
export type PlanAssignInput = z.infer<typeof PlatformContract.planAssign>;
export type AdjustmentSaveInput = z.infer<typeof PlatformContract.adjustmentSave>;
export type AdjustedDto = z.infer<typeof PlatformContract.adjusted>;
export type AdjustmentClearInput = z.infer<typeof PlatformContract.adjustmentClear>;
export type AccountDto = z.infer<typeof PlatformContract.account>;
export type AccountMembershipDto = z.infer<typeof PlatformContract.accountMembership>;
export type AccountDenyDto = z.infer<typeof PlatformContract.accountDeny>;
export type AccountQueryInput = z.infer<typeof PlatformContract.accountQuery>;
export type AccountSuspensionInput = z.infer<typeof PlatformContract.accountSuspension>;
export type AccountDenySaveInput = z.infer<typeof PlatformContract.accountDenySave>;
export type AccountDenyClearInput = z.infer<typeof PlatformContract.accountDenyClear>;
export type ModuleSwitchDto = z.infer<typeof PlatformContract.moduleSwitch>;
export type ModuleSwitchUpdateInput = z.infer<typeof PlatformContract.moduleSwitchUpdate>;
export type FlagTargetDto = z.infer<typeof PlatformContract.flagTarget>;
export type FlagToggleInput = z.infer<typeof PlatformContract.flagToggle>;
export type FlagTargetToggleInput = z.infer<typeof PlatformContract.flagTargetToggle>;
export type TenantExportInput = z.infer<typeof PlatformContract.tenantExport>;
export type ExportRequestedDto = z.infer<typeof PlatformContract.exportRequested>;
export type TenantExportObjectDto = z.infer<typeof PlatformContract.tenantExportObject>;
export type DeleteRequestedDto = z.infer<typeof PlatformContract.deleteRequested>;
export type PlatformStatusDto = z.infer<typeof PlatformContract.status>;
