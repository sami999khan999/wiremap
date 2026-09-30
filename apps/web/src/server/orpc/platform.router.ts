import { authed } from "../import.js";

// The proof page's one handler. `ProcedurePermissions` gates the path before this runs
// and the use-case asserts again — the two are deliberate, not redundant.
export class PlatformRouter {
  private constructor() {}

  public static readonly status = authed.platform.status.handler(({ context }) =>
    context.container.platformAdmin.inspectStatus.execute(context.principal),
  );

  public static readonly listRetention = authed.platform.listRetention.handler(({ context }) =>
    context.container.platformAdmin.listRetention.execute(context.principal),
  );

  public static readonly previewRetention = authed.platform.previewRetention.handler(
    ({ input, context }) =>
      context.container.platformAdmin.previewRetention.execute(context.principal, input),
  );

  public static readonly restorePartition = authed.platform.restorePartition.handler(
    ({ input, context }) =>
      context.container.platformAdmin.restorePartition.execute(context.principal, input),
  );

  public static readonly updateTenantRetention = authed.platform.updateTenantRetention.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.updateTenantRetention.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly deleteTenant = authed.platform.deleteTenant.handler(({ input, context }) =>
    context.container.platformAdmin.deleteOrganization.execute(context.principal, input),
  );

  public static readonly exportTenant = authed.platform.exportTenant.handler(({ input, context }) =>
    context.container.platformAdmin.exportOrganization.execute(context.principal, input),
  );

  public static readonly listExports = authed.platform.listExports.handler(({ input, context }) =>
    context.container.platformAdmin.listExports.execute(context.principal, input),
  );

  public static readonly listGaps = authed.platform.listGaps.handler(({ context }) =>
    context.container.platformAdmin.listGaps.execute(context.principal),
  );

  public static readonly reprojectPartition = authed.platform.reprojectPartition.handler(
    ({ input, context }) =>
      context.container.platformAdmin.reprojectPartition.execute(context.principal, input),
  );

  public static readonly getPolicy = authed.platform.getPolicy.handler(async ({ context }) => {
    const policy = await context.container.platformAdmin.getPolicy.execute(context.principal);
    return policy;
  });

  public static readonly updateProjectionSwitch = authed.platform.updateProjectionSwitch.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.toggleProjection.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly updateReplicaSwitch = authed.platform.updateReplicaSwitch.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.toggleReplicaReads.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  // Copied, not cast: the use-case hands out readonly arrays and the wire type is mutable.
  public static readonly listFlags = authed.platform.listFlags.handler(async ({ context }) => {
    const flags = await context.container.platformAdmin.listFlags.execute(context.principal);
    return { items: flags.map((flag) => ({ ...flag, targets: [...flag.targets] })) };
  });

  public static readonly updateFlag = authed.platform.updateFlag.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.updateFlag.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly updateFlagTarget = authed.platform.updateFlagTarget.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.updateFlagTarget.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly listPlans = authed.platform.listPlans.handler(({ context }) =>
    context.container.platformAdmin.listPlans.execute(context.principal),
  );

  public static readonly savePlan = authed.platform.savePlan.handler(async ({ input, context }) => {
    await context.container.platformAdmin.savePlan.execute(context.principal, input);
    return { ok: true } as const;
  });

  public static readonly deletePlan = authed.platform.deletePlan.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.deletePlan.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly updateDefaultPlan = authed.platform.updateDefaultPlan.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.updateDefaultPlan.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly organizationEntitlement = authed.platform.organizationEntitlement.handler(
    ({ input, context }) =>
      context.container.platformAdmin.organizationEntitlement.execute(context.principal, input),
  );

  // Placed on the tier like every platform request: accounts, memberships and overrides
  // are all catalog, so nothing here has a tenant node to reach.
  public static readonly findAccount = authed.platform.findAccount.handler(({ input, context }) =>
    context.container.accounts.findAccount.execute(context.principal, input),
  );

  public static readonly suspendAccount = authed.platform.suspendAccount.handler(
    async ({ input, context }) => {
      await context.container.accounts.suspendAccount.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly reinstateAccount = authed.platform.reinstateAccount.handler(
    async ({ input, context }) => {
      await context.container.accounts.reinstateAccount.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly denyAccountPermission = authed.platform.denyAccountPermission.handler(
    async ({ input, context }) => ({
      permissions: await context.container.accounts.denyAccountPermission.execute(
        context.principal,
        input,
      ),
    }),
  );

  public static readonly clearAccountDeny = authed.platform.clearAccountDeny.handler(
    async ({ input, context }) => {
      await context.container.accounts.clearAccountDeny.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly assignPlan = authed.platform.assignPlan.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.assignPlan.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly adjustEntitlement = authed.platform.adjustEntitlement.handler(
    async ({ input, context }) => ({
      permissions: await context.container.platformAdmin.adjustEntitlement.execute(
        context.principal,
        input,
      ),
    }),
  );

  public static readonly clearAdjustment = authed.platform.clearAdjustment.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.clearAdjustment.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly moduleSwitches = authed.platform.moduleSwitches.handler(
    async ({ context }) => ({
      items: await context.container.platformAdmin.moduleSwitches.execute(context.principal),
    }),
  );

  public static readonly updateModuleSwitch = authed.platform.updateModuleSwitch.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.switchModule.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly listProjection = authed.platform.listProjection.handler(({ context }) =>
    context.container.platformAdmin.listProjection.execute(context.principal),
  );

  public static readonly updateProjection = authed.platform.updateProjection.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.updateProjection.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly listStorage = authed.platform.listStorage.handler(({ input, context }) =>
    context.container.platformAdmin.listStorage.execute(context.principal, input),
  );

  // `acknowledged` rather than the row: the screen refetches the list, which also
  // carries what the bucket and ClickHouse now hold, and one of those may have drifted.
  public static readonly updateRetention = authed.platform.updateRetention.handler(
    async ({ input, context }) => {
      await context.container.platformAdmin.updateRetention.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly shardMap = authed.platform.shardMap.handler(({ input, context }) =>
    context.container.platformAdmin.inspectShardMap.execute(context.principal, input),
  );

  public static readonly locateTenant = authed.platform.locateTenant.handler(({ input, context }) =>
    context.container.platformAdmin.locateTenant.execute(context.principal, input),
  );

  // Queues, never runs: the move is placed on nothing and names both nodes itself, and
  // the request is placed on the admin's tenant, which is neither of them.
  public static readonly moveTenant = authed.platform.moveTenant.handler(({ input, context }) =>
    context.container.platformAdmin.moveTenant.execute(context.principal, input),
  );

  // The object the merge point in `app.router.ts` mounts, mirroring
  // `PlatformProcedures.all`.
  public static readonly all = {
    status: PlatformRouter.status,
    listRetention: PlatformRouter.listRetention,
    previewRetention: PlatformRouter.previewRetention,
    restorePartition: PlatformRouter.restorePartition,
    updateTenantRetention: PlatformRouter.updateTenantRetention,
    listStorage: PlatformRouter.listStorage,
    getPolicy: PlatformRouter.getPolicy,
    listGaps: PlatformRouter.listGaps,
    reprojectPartition: PlatformRouter.reprojectPartition,
    updateProjectionSwitch: PlatformRouter.updateProjectionSwitch,
    updateReplicaSwitch: PlatformRouter.updateReplicaSwitch,
    listProjection: PlatformRouter.listProjection,
    updateProjection: PlatformRouter.updateProjection,
    deleteTenant: PlatformRouter.deleteTenant,
    exportTenant: PlatformRouter.exportTenant,
    listExports: PlatformRouter.listExports,
    updateRetention: PlatformRouter.updateRetention,
    shardMap: PlatformRouter.shardMap,
    locateTenant: PlatformRouter.locateTenant,
    moveTenant: PlatformRouter.moveTenant,
    listFlags: PlatformRouter.listFlags,
    updateFlag: PlatformRouter.updateFlag,
    updateFlagTarget: PlatformRouter.updateFlagTarget,
    listPlans: PlatformRouter.listPlans,
    savePlan: PlatformRouter.savePlan,
    deletePlan: PlatformRouter.deletePlan,
    updateDefaultPlan: PlatformRouter.updateDefaultPlan,
    organizationEntitlement: PlatformRouter.organizationEntitlement,
    findAccount: PlatformRouter.findAccount,
    suspendAccount: PlatformRouter.suspendAccount,
    reinstateAccount: PlatformRouter.reinstateAccount,
    denyAccountPermission: PlatformRouter.denyAccountPermission,
    clearAccountDeny: PlatformRouter.clearAccountDeny,
    assignPlan: PlatformRouter.assignPlan,
    adjustEntitlement: PlatformRouter.adjustEntitlement,
    clearAdjustment: PlatformRouter.clearAdjustment,
    moduleSwitches: PlatformRouter.moduleSwitches,
    updateModuleSwitch: PlatformRouter.updateModuleSwitch,
  } as const;
}
