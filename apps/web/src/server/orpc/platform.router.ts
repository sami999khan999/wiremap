import { authed } from "../import.js";

// The proof page's one handler. `ProcedurePermissions` gates the path before this runs
// and the use-case asserts again — the two are deliberate, not redundant.
export class PlatformRouter {
  private constructor() {}

  public static readonly status = authed.platform.status.handler(({ context }) =>
    context.container.platformAdmin.inspectStatus.execute(context.principal),
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

  public static readonly githubApp = authed.platform.githubApp.handler(({ context }) =>
    context.container.github.app.get(context.principal),
  );

  public static readonly startGithubApp = authed.platform.startGithubApp.handler(
    ({ input, context }) => context.container.github.app.start(context.principal, input),
  );

  public static readonly removeGithubApp = authed.platform.removeGithubApp.handler(
    async ({ context }) => {
      await context.container.github.app.remove(context.principal);
      return { ok: true } as const;
    },
  );

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

  // The object the merge point in `app.router.ts` mounts, mirroring
  // `PlatformProcedures.all`.
  public static readonly all = {
    status: PlatformRouter.status,
    updateReplicaSwitch: PlatformRouter.updateReplicaSwitch,
    deleteTenant: PlatformRouter.deleteTenant,
    exportTenant: PlatformRouter.exportTenant,
    listExports: PlatformRouter.listExports,
    listFlags: PlatformRouter.listFlags,
    githubApp: PlatformRouter.githubApp,
    startGithubApp: PlatformRouter.startGithubApp,
    removeGithubApp: PlatformRouter.removeGithubApp,
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
