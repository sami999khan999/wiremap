import type { PermissionKey } from "../import.js";

// One entry per path in `PlatformProcedures`, and every platform key is asserted by one
// of them — `check-architecture.mjs` §28 fails the build on a key nothing asserts.
export const platformProcedurePermissions = {
  "platform.status": "platform.status.read",
  // Manage: routing a read off the primary is a change to what every batch job sees.
  "platform.updateReplicaSwitch": "platform.replica.manage",
  "platform.deleteTenant": "platform.tenant.manage",
  "platform.exportTenant": "platform.tenant.manage",
  "platform.listExports": "platform.tenant.manage",
  "platform.listFlags": "platform.flag.read",
  "platform.updateFlag": "platform.flag.manage",
  "platform.updateFlagTarget": "platform.flag.manage",
  // Manage alone: what the App is called and who owns it is only for whoever may replace it.
  "platform.githubApp": "platform.github.manage",
  "platform.startGithubApp": "platform.github.manage",
  "platform.removeGithubApp": "platform.github.manage",
  "platform.listPlans": "platform.entitlement.read",
  "platform.savePlan": "platform.entitlement.manage",
  "platform.deletePlan": "platform.entitlement.manage",
  "platform.updateDefaultPlan": "platform.entitlement.manage",
  "platform.organizationEntitlement": "platform.entitlement.read",
  "platform.assignPlan": "platform.entitlement.manage",
  "platform.adjustEntitlement": "platform.entitlement.manage",
  "platform.clearAdjustment": "platform.entitlement.manage",
  // Read under status: which modules are down is status, read by the people on call.
  "platform.findAccount": "platform.account.read",
  "platform.suspendAccount": "platform.account.manage",
  "platform.reinstateAccount": "platform.account.manage",
  "platform.denyAccountPermission": "platform.account.manage",
  "platform.clearAccountDeny": "platform.account.manage",
  "platform.moduleSwitches": "platform.status.read",
  "platform.updateModuleSwitch": "platform.module.manage",
} as const satisfies Record<string, PermissionKey>;
