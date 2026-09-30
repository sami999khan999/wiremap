import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

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

  // `archive` drops the month behind a verified object; `drop` destroys it. Two words
  // rather than a boolean, because `skipArchive: false` reads as the opposite.
  public static readonly coldMode = z.enum(["archive", "drop"]);

  public static readonly store = z.enum(["postgres", "clickhouse"]);

  public static readonly retentionEntry = z.object({
    tableName: z.string().min(1),
    // Null is "the calendar never retires this table" — `messages`, which is domain
    // data. Not zero, which would mean dropping the month being written to.
    hotMonths: z.number().int().nullable(),
    coldMonths: z.number().int().nullable(),
    coldMode: PlatformContract.coldMode,
    // True when the numbers come from the allowlist rather than a row. "12 because
    // nobody has decided" reads differently on a screen from "12".
    isDefault: z.boolean(),
    neverDropped: z.boolean(),
  });

  public static readonly clickhouseRetention = z.object({
    months: z.number().int(),
    isDefault: z.boolean(),
    // What the store holds beside what the rows compose to. A screen showing only the
    // rows would say "saved" about a call that failed after the commit.
    applied: z.string(),
    expected: z.string(),
  });

  public static readonly retention = z.object({
    postgres: z.array(PlatformContract.retentionEntry).readonly(),
    // Absent on a deployment running no analytics store, which is the third state the
    // screen renders — not configured, rather than on or off.
    clickhouse: PlatformContract.clickhouseRetention.nullable(),
    lifecycle: z.object({
      applied: z.array(z.string()).readonly(),
      expected: z.array(z.string()).readonly(),
    }),
  });

  // The tenant leads, as the row does. `tableName` is still a string and still
  // validated one layer in, for the reason every other table name here is.
  public static readonly tenantRetentionUpdate = z.object({
    organizationId: Identifiers.organizationId,
    tableName: z.string().min(1).max(64),
    hotMonths: z.number().int().min(1).max(600),
    coldMonths: z.number().int().min(0).max(600).nullable(),
  });

  public static readonly restore = z.object({
    tableName: z.string().min(1).max(64),
    // The first of a month, which is what `partition_archive` stores and what a replay
    // is asked for. A mid-month date names no partition.
    period: z.string().regex(/^\d{4}-\d{2}-01$/),
    // Absent restores every tenant that has a row for the month, which is what an
    // operator means by "restore March".
    organizationId: Identifiers.organizationId.optional(),
  });

  public static readonly restoreRequested = z.object({
    jobId: z.string().min(1),
    objects: z.number().int(),
  });

  public static readonly previewQuery = z.object({
    tableName: z.string().min(1).max(64),
    hotMonths: z.coerce.number().int().min(1).max(600),
    // Absent previews the table across every tenant; present previews one tenant's
    // override, which is the only number the row being edited will actually act on.
    organizationId: Identifiers.organizationId.optional(),
  });

  public static readonly retentionPreview = z.object({
    tableName: z.string().min(1),
    hotMonths: z.number().int(),
    // Echoed back, so a screen cannot render a tenant's preview under the table's
    // heading when a slow response arrives after the operator moved on.
    organizationId: Identifiers.organizationId.nullable(),
    partitions: z
      .array(
        z.object({
          name: z.string().min(1),
          period: z.string().min(1),
          estimatedRows: z.number().int(),
          bytes: z.number().int(),
        }),
      )
      .readonly(),
    totalPartitions: z.number().int(),
    // The planner's number, refreshed by autovacuum — the screen says "about", and the
    // field is named for what it is rather than for what a reader would like it to be.
    estimatedRows: z.number().int(),
    bytes: z.number().int(),
  });

  // The slug travels with the id and the server compares them. A confirmation only
  // the browser checks is a confirmation the API does not have.
  public static readonly tenantDelete = z.object({
    organizationId: Identifiers.organizationId,
    slug: z.string().min(1).max(64),
  });

  public static readonly projectionGap = z.object({
    tableName: z.string().min(1),
    period: z.string().min(1),
    // Objects carrying a null `projected_at`, not objects that exist. The reason a
    // gap exists is on a log line and not stored, so this says only that one does.
    tenants: z.number().int(),
    rows: z.number().int(),
  });

  public static readonly reproject = z.object({
    period: z.string().regex(/^\d{4}-\d{2}-01$/),
    organizationId: Identifiers.organizationId.optional(),
  });

  public static readonly reprojectRequested = z.object({
    jobId: z.string().min(1),
    objects: z.number().int(),
  });

  public static readonly policy = z.object({
    projectionEnabled: z.boolean(),
    replicaReadsEnabled: z.boolean(),
    // The third state, and the one the screen has to render differently: absent is
    // "this deployment runs no analytics store", which is neither on nor off.
    analyticsConfigured: z.boolean(),
  });

  public static readonly projectionToggle = z.object({ enabled: z.boolean() });

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

  public static readonly projectionEntry = z.object({
    action: z.string().min(1),
    label: z.string().min(1),
    // The action's own prefix. The screen groups by it, which is the only reason it
    // is on the wire rather than derived again in the browser.
    module: z.string().min(1),
    projected: z.boolean(),
    ttlMonths: z.number().int().nullable(),
    isDefault: z.boolean(),
  });

  public static readonly projection = z.object({
    actions: z.array(PlatformContract.projectionEntry).readonly(),
    defaultMonths: z.number().int(),
    // What the store holds beside what the rows compose to, so the screen can show
    // drift rather than assume the last write landed.
    applied: z.string(),
    expected: z.string(),
    // The third state: not configured, rather than on or off.
    configured: z.boolean(),
  });

  // `action` stays a string and is validated against `ActivityActions.isKnown` one
  // layer in, for the reason every table name here is.
  public static readonly projectionUpdate = z.object({
    action: z.string().min(1).max(128),
    projected: z.boolean(),
    ttlMonths: z.number().int().min(1).max(120).nullable(),
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

  // Cold storage only, and the screen says so: a partition holds one tenant's rows,
  // but Postgres reports size per table, so hot bytes cannot be attributed here.
  public static readonly tenantStorageRow = z.object({
    organizationId: Identifiers.organizationId,
    // Null once the tenant is deleted: the archive outlives it by thirty days, and a
    // row whose name resolves to nothing is what an operator came here to find.
    organizationName: z.string().nullable(),
    tableName: z.string().min(1),
    bytes: z.number().int(),
    rows: z.number().int(),
    months: z.number().int(),
  });

  public static readonly tenantStorageMonth = z.object({
    tableName: z.string().min(1),
    period: z.string().min(1),
    bytes: z.number().int(),
    rows: z.number().int(),
    actionCounts: z.record(z.string(), z.number().int()),
    projectedAt: z.date().nullable(),
  });

  public static readonly tenantStorageQuery = Pagination.query.extend({
    // Narrows the page to one tenant and fills `months`. Absent is the league table,
    // which is the question this screen usually answers.
    organizationId: Identifiers.organizationId.optional(),
  });

  public static readonly tenantStorage = z.object({
    items: z.array(PlatformContract.tenantStorageRow).readonly(),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    months: z.array(PlatformContract.tenantStorageMonth).readonly(),
  });

  // `tableName` stays a string and is validated against `PartitionedTable.NAMES` in the
  // use-case: a table name never comes from data, and the closed union is one layer in.
  public static readonly retentionUpdate = z.object({
    store: PlatformContract.store,
    tableName: z.string().min(1).max(64),
    hotMonths: z.number().int().min(1).max(600),
    coldMonths: z.number().int().min(0).max(600).nullable(),
    coldMode: PlatformContract.coldMode,
  });

  // One physical node, counted out of the directory rather than out of the cluster: a
  // node the deployment has just added holds no tenant and so has no row here.
  public static readonly shardNode = z.object({
    node: z.number().int().nonnegative(),
    tenants: z.number().int().nonnegative(),
    lastAssignedAt: z.date(),
    // Null until something on this node has been moved. `moved_at` is stamped only when
    // the node actually changes, so this is "when did this node last receive one".
    lastMovedAt: z.date().nullable(),
  });

  public static readonly shardTenant = z.object({
    organizationId: Identifiers.organizationId,
    slug: z.string().min(1),
    name: z.string().min(1),
    node: z.number().int().nonnegative(),
    assignedAt: z.date(),
    movedAt: z.date().nullable(),
    // How many tables this tenant overrides, not the numbers themselves: the numbers
    // are one screen away, and the count is what says whether to go there.
    retentionOverrides: z.number().int().nonnegative(),
  });

  // Two words rather than a boolean. `movesEnabled: false` reads as a switch somebody
  // turned off; this is a mechanism that has not been built yet.
  public static readonly shardMoves = z.enum(["unavailable", "available"]);

  public static readonly shardMapQuery = Pagination.query.extend({
    // Absent is the node list on its own. Present expands one node, which is what the
    // screen asks for on a click.
    node: z.number().int().nonnegative().optional(),
  });

  public static readonly shardMap = z.object({
    nodes: z.array(PlatformContract.shardNode).readonly(),
    // Empty unless a node was named. Every node's tenants at once is the whole
    // directory, which is the one read this screen must never make.
    tenants: z.array(PlatformContract.shardTenant).readonly(),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    moves: PlatformContract.shardMoves,
  });

  // A node by index, bounded above by the server: the contract cannot know how many
  // nodes this deployment has, and the use-case refuses one it does not.
  public static readonly tenantMove = z.object({
    organizationId: Identifiers.organizationId,
    toNode: z.number().int().nonnegative(),
  });

  public static readonly moveRequested = z.object({
    jobId: z.string().min(1),
  });

  // An id or a slug, whichever the operator is holding. Trimmed and bounded, because
  // an empty term is a request for the whole directory wearing a search box.
  public static readonly tenantLookup = z.object({
    term: z.string().trim().min(1).max(128),
  });

  // Null is "no tenant answers to that", which is a normal answer to a typed search
  // and not a `NOT_FOUND`.
  public static readonly tenantLocation = z.object({
    tenant: PlatformContract.shardTenant.nullable(),
    moves: PlatformContract.shardMoves,
  });
}

export type ColdModeDto = z.infer<typeof PlatformContract.coldMode>;
export type PlatformHealthDto = z.infer<typeof PlatformContract.health>;
export type RetentionDto = z.infer<typeof PlatformContract.retention>;
export type RetentionEntryDto = z.infer<typeof PlatformContract.retentionEntry>;
export type RestoreInput = z.infer<typeof PlatformContract.restore>;
export type TenantRetentionUpdateInput = z.infer<typeof PlatformContract.tenantRetentionUpdate>;
export type RestoreRequestedDto = z.infer<typeof PlatformContract.restoreRequested>;
export type RetentionPreviewDto = z.infer<typeof PlatformContract.retentionPreview>;
export type RetentionUpdateInput = z.infer<typeof PlatformContract.retentionUpdate>;
export type TenantDeleteInput = z.infer<typeof PlatformContract.tenantDelete>;
export type PlatformPolicyDto = z.infer<typeof PlatformContract.policy>;
export type ProjectionGapDto = z.infer<typeof PlatformContract.projectionGap>;
export type ReprojectInput = z.infer<typeof PlatformContract.reproject>;
export type ReprojectRequestedDto = z.infer<typeof PlatformContract.reprojectRequested>;
export type ProjectionToggleInput = z.infer<typeof PlatformContract.projectionToggle>;
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
export type ProjectionDto = z.infer<typeof PlatformContract.projection>;
export type ProjectionEntryDto = z.infer<typeof PlatformContract.projectionEntry>;
export type ProjectionUpdateInput = z.infer<typeof PlatformContract.projectionUpdate>;
export type TenantExportInput = z.infer<typeof PlatformContract.tenantExport>;
export type ExportRequestedDto = z.infer<typeof PlatformContract.exportRequested>;
export type TenantExportObjectDto = z.infer<typeof PlatformContract.tenantExportObject>;
export type DeleteRequestedDto = z.infer<typeof PlatformContract.deleteRequested>;
export type TenantStorageDto = z.infer<typeof PlatformContract.tenantStorage>;
export type TenantStorageRowDto = z.infer<typeof PlatformContract.tenantStorageRow>;
export type TenantStorageMonthDto = z.infer<typeof PlatformContract.tenantStorageMonth>;
export type TenantStorageQuery = z.infer<typeof PlatformContract.tenantStorageQuery>;
export type PlatformStatusDto = z.infer<typeof PlatformContract.status>;
export type ShardNodeDto = z.infer<typeof PlatformContract.shardNode>;
export type ShardTenantDto = z.infer<typeof PlatformContract.shardTenant>;
export type ShardMapDto = z.infer<typeof PlatformContract.shardMap>;
export type ShardMapQuery = z.infer<typeof PlatformContract.shardMapQuery>;
export type ShardMovesDto = z.infer<typeof PlatformContract.shardMoves>;
export type TenantLookupInput = z.infer<typeof PlatformContract.tenantLookup>;
export type TenantLocationDto = z.infer<typeof PlatformContract.tenantLocation>;
export type TenantMoveInput = z.infer<typeof PlatformContract.tenantMove>;
export type MoveRequestedDto = z.infer<typeof PlatformContract.moveRequested>;
