import type { PermissionKey } from "../import.js";

// One entry per path in `PlatformProcedures`, and every platform key is asserted by one
// of them — `check-architecture.mjs` §28 fails the build on a key nothing asserts.
export const platformProcedurePermissions = {
  "platform.status": "platform.status.read",
  // Read and manage split, because they are not the same risk: seeing how long data is
  // kept is an operational question, and shortening it destroys rows on the next run.
  "platform.listRetention": "platform.retention.read",
  // Read, not manage: seeing what a change would destroy must not require the right
  // to cause it, or nobody reviews the number before somebody with the right types it.
  "platform.previewRetention": "platform.retention.read",
  "platform.updateRetention": "platform.retention.manage",
  // Manage, not read: a restore writes a table and, inside the hot window, attaches
  // it — which is a change to what the live database holds.
  "platform.restorePartition": "platform.retention.manage",
  "platform.updateTenantRetention": "platform.retention.manage",
  "platform.listStorage": "platform.storage.read",
  "platform.getPolicy": "platform.analytics.read",
  "platform.listGaps": "platform.analytics.read",
  "platform.reprojectPartition": "platform.analytics.manage",
  "platform.updateProjectionSwitch": "platform.analytics.manage",
  "platform.listProjection": "platform.analytics.read",
  "platform.updateProjection": "platform.analytics.manage",
  // Manage: routing a read off the primary is a change to what every batch job sees.
  "platform.updateReplicaSwitch": "platform.replica.manage",
  "platform.deleteTenant": "platform.tenant.manage",
  "platform.exportTenant": "platform.tenant.manage",
  "platform.listExports": "platform.tenant.manage",
  // Read, not manage: the map is where an operator finds out *whether* a move is needed,
  // and gating that behind the right to perform one means nobody checks first.
  "platform.shardMap": "platform.shards.read",
  "platform.locateTenant": "platform.shards.read",
  // Manage: a move freezes the tenant's writes for as long as the copy takes.
  "platform.moveTenant": "platform.shards.manage",
  "platform.listFlags": "platform.flag.read",
  "platform.updateFlag": "platform.flag.manage",
  "platform.updateFlagTarget": "platform.flag.manage",
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
