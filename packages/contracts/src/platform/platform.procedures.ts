import { oc, z } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { PlatformContract } from "./platform.contract.js";

export class PlatformProcedures {
  private constructor() {}

  // No input: the tier is one organization and the report is the whole deployment's.
  // The permission is what makes this a platform read rather than a public probe.
  public static readonly status = oc
    .route({ method: "GET", path: "/platform/status" })
    .output(PlatformContract.status);

  // `DELETE` on the tenant, and the body carries the slug: the id is what is being
  // removed and the slug is the operator saying they know which one.
  public static readonly deleteTenant = oc
    .route({ method: "DELETE", path: "/platform/tenants" })
    .input(PlatformContract.tenantDelete)
    .output(PlatformContract.deleteRequested);

  // `POST` and a job id back: an export is a full read of seven tables streamed to
  // S3, and a request that waited for it would hold a connection open for minutes.
  public static readonly exportTenant = oc
    .route({ method: "POST", path: "/platform/tenants/export" })
    .input(PlatformContract.tenantExport)
    .output(PlatformContract.exportRequested);

  public static readonly listExports = oc
    .route({ method: "GET", path: "/platform/tenants/export" })
    .input(PlatformContract.tenantExport)
    .output(z.array(PlatformContract.tenantExportObject).readonly());

  // `start` returns a form rather than redirecting: GitHub takes the manifest as a POST
  // field, so the browser has to submit it. Completing is `/api/github/manifest`.
  public static readonly githubApp = oc
    .route({ method: "GET", path: "/platform/github-app" })
    .output(PlatformContract.githubApp);

  public static readonly startGithubApp = oc
    .route({ method: "POST", path: "/platform/github-app" })
    .input(PlatformContract.githubAppStart)
    .output(PlatformContract.githubAppForm);

  public static readonly removeGithubApp = oc
    .route({ method: "DELETE", path: "/platform/github-app" })
    .output(Envelope.acknowledged);

  public static readonly updateReplicaSwitch = oc
    .route({ method: "PUT", path: "/platform/policy/replica" })
    .input(PlatformContract.replicaToggle)
    .output(Envelope.acknowledged);

  // Every flag, server-only ones included. The one place those names leave the server,
  // and only to a platform admin.
  public static readonly listFlags = oc
    .route({ method: "GET", path: "/platform/flags" })
    .output(PlatformContract.flagList);

  public static readonly updateFlag = oc
    .route({ method: "PUT", path: "/platform/flags" })
    .input(PlatformContract.flagToggle)
    .output(Envelope.acknowledged);

  public static readonly updateFlagTarget = oc
    .route({ method: "PUT", path: "/platform/flags/organization" })
    .input(PlatformContract.flagTargetToggle)
    .output(Envelope.acknowledged);

  public static readonly listPlans = oc
    .route({ method: "GET", path: "/platform/plans" })
    .output(PlatformContract.planList);

  public static readonly savePlan = oc
    .route({ method: "PUT", path: "/platform/plans" })
    .input(PlatformContract.planSave)
    .output(Envelope.acknowledged);

  public static readonly deletePlan = oc
    .route({ method: "DELETE", path: "/platform/plans" })
    .input(PlatformContract.planRef)
    .output(Envelope.acknowledged);

  // What the next signup lands on (`RV.14`). Not on the plan's own row: one default, many plans.
  public static readonly updateDefaultPlan = oc
    .route({ method: "PUT", path: "/platform/plans/default" })
    .input(PlatformContract.planRef)
    .output(Envelope.acknowledged);

  public static readonly organizationEntitlement = oc
    .route({ method: "GET", path: "/platform/entitlements" })
    .input(PlatformContract.organizationRef)
    .output(PlatformContract.organizationEntitlement);

  public static readonly assignPlan = oc
    .route({ method: "PUT", path: "/platform/entitlements/plan" })
    .input(PlatformContract.planAssign)
    .output(Envelope.acknowledged);

  public static readonly adjustEntitlement = oc
    .route({ method: "PUT", path: "/platform/entitlements/adjustments" })
    .input(PlatformContract.adjustmentSave)
    .output(PlatformContract.adjusted);

  public static readonly clearAdjustment = oc
    .route({ method: "DELETE", path: "/platform/entitlements/adjustments" })
    .input(PlatformContract.adjustmentClear)
    .output(Envelope.acknowledged);

  // By address in the query string, because that is what a support ticket carries.
  public static readonly findAccount = oc
    .route({ method: "GET", path: "/platform/accounts" })
    .input(PlatformContract.accountQuery)
    .output(PlatformContract.account);

  public static readonly suspendAccount = oc
    .route({ method: "POST", path: "/platform/accounts/suspend" })
    .input(PlatformContract.accountSuspension)
    .output(Envelope.acknowledged);

  public static readonly reinstateAccount = oc
    .route({ method: "POST", path: "/platform/accounts/reinstate" })
    .input(PlatformContract.accountSuspension)
    .output(Envelope.acknowledged);

  public static readonly denyAccountPermission = oc
    .route({ method: "POST", path: "/platform/accounts/denies" })
    .input(PlatformContract.accountDenySave)
    .output(PlatformContract.adjusted);

  public static readonly clearAccountDeny = oc
    .route({ method: "DELETE", path: "/platform/accounts/denies" })
    .input(PlatformContract.accountDenyClear)
    .output(Envelope.acknowledged);

  public static readonly moduleSwitches = oc
    .route({ method: "GET", path: "/platform/modules" })
    .output(PlatformContract.moduleSwitchList);

  public static readonly updateModuleSwitch = oc
    .route({ method: "PUT", path: "/platform/modules" })
    .input(PlatformContract.moduleSwitchUpdate)
    .output(Envelope.acknowledged);

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    status: PlatformProcedures.status,
    updateReplicaSwitch: PlatformProcedures.updateReplicaSwitch,
    deleteTenant: PlatformProcedures.deleteTenant,
    exportTenant: PlatformProcedures.exportTenant,
    listExports: PlatformProcedures.listExports,
    listFlags: PlatformProcedures.listFlags,
    githubApp: PlatformProcedures.githubApp,
    startGithubApp: PlatformProcedures.startGithubApp,
    removeGithubApp: PlatformProcedures.removeGithubApp,
    updateFlag: PlatformProcedures.updateFlag,
    updateFlagTarget: PlatformProcedures.updateFlagTarget,
    listPlans: PlatformProcedures.listPlans,
    savePlan: PlatformProcedures.savePlan,
    deletePlan: PlatformProcedures.deletePlan,
    updateDefaultPlan: PlatformProcedures.updateDefaultPlan,
    organizationEntitlement: PlatformProcedures.organizationEntitlement,
    findAccount: PlatformProcedures.findAccount,
    suspendAccount: PlatformProcedures.suspendAccount,
    reinstateAccount: PlatformProcedures.reinstateAccount,
    denyAccountPermission: PlatformProcedures.denyAccountPermission,
    clearAccountDeny: PlatformProcedures.clearAccountDeny,
    assignPlan: PlatformProcedures.assignPlan,
    adjustEntitlement: PlatformProcedures.adjustEntitlement,
    clearAdjustment: PlatformProcedures.clearAdjustment,
    moduleSwitches: PlatformProcedures.moduleSwitches,
    updateModuleSwitch: PlatformProcedures.updateModuleSwitch,
  } as const;
}
