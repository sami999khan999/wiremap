import type {
  AccountDenyClearInput,
  AccountDenySaveInput,
  AccountSuspensionInput,
  AdjustedDto,
  AdjustmentClearInput,
  AdjustmentSaveInput,
  ApiClient,
  DeleteRequestedDto,
  ExportRequestedDto,
  FlagTargetToggleInput,
  FlagToggleInput,
  ModuleSwitchUpdateInput,
  MoveRequestedDto,
  PlanAssignInput,
  PlanRefInput,
  PlanSaveInput,
  ProjectionToggleInput,
  ProjectionUpdateInput,
  ReplicaToggleInput,
  ReprojectInput,
  ReprojectRequestedDto,
  RestoreInput,
  RestoreRequestedDto,
  RetentionUpdateInput,
  TenantDeleteInput,
  TenantExportInput,
  TenantMoveInput,
  TenantRetentionUpdateInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class PlatformMutations {
  private constructor() {}

  // No optimistic update: the refetched list carries what the bucket and ClickHouse
  // *now* hold, and an optimistic row would hide the drift the save may have caused.
  public static useUpdateRetention(client: ApiClient) {
    return useAppMutation<{ ok: true }, RetentionUpdateInput>({
      mutationFn: (input) => client.platform.updateRetention(input),
      invalidates: [QueryKeys.platform.retention()],
    });
  }

  // Invalidates the list, which does not carry overrides — but a second tab showing
  // stale table defaults beside a changed override is the confusion worth avoiding.
  public static useUpdateTenantRetention(client: ApiClient) {
    return useAppMutation<{ ok: true }, TenantRetentionUpdateInput>({
      mutationFn: (input) => client.platform.updateTenantRetention(input),
      invalidates: [QueryKeys.platform.retention()],
    });
  }

  // `all()`, not the storage key alone: a deleted tenant leaves the storage table and
  // takes its retention overrides with it, so every platform read has changed.
  public static useDeleteTenant(client: ApiClient) {
    return useAppMutation<DeleteRequestedDto, TenantDeleteInput>({
      mutationFn: (input) => client.platform.deleteTenant(input),
      invalidates: [QueryKeys.platform.all()],
    });
  }

  // Invalidates nothing: the job has only been queued, and the map changes when the
  // worker flips the node — refetching now would show the tenant where it still is.
  public static useMoveTenant(client: ApiClient) {
    return useAppMutation<MoveRequestedDto, TenantMoveInput>({
      mutationFn: (input) => client.platform.moveTenant(input),
      invalidates: [],
    });
  }

  // Invalidates nothing, for the reason the restore below gives: the job has only been
  // queued, so refetching the list now would show the objects the last export wrote.
  public static useExportTenant(client: ApiClient) {
    return useAppMutation<ExportRequestedDto, TenantExportInput>({
      mutationFn: (input) => client.platform.exportTenant(input),
      invalidates: [],
    });
  }

  // Invalidates nothing: the job has only been queued, and the gap closes when the
  // worker stamps `projected_at` rather than when the request returns.
  public static useReprojectPartition(client: ApiClient) {
    return useAppMutation<ReprojectRequestedDto, ReprojectInput>({
      mutationFn: (input) => client.platform.reprojectPartition(input),
      invalidates: [],
    });
  }

  // Both keys: pausing the projection changes the switch and makes every per-action
  // row on the same screen moot until it is resumed.
  public static useToggleProjection(client: ApiClient) {
    return useAppMutation<{ ok: true }, ProjectionToggleInput>({
      mutationFn: (input) => client.platform.updateProjectionSwitch(input),
      invalidates: [QueryKeys.platform.policy(), QueryKeys.platform.projection()],
    });
  }

  // The status key, because that is where the switch is read: the page showing the lag
  // is the one that says whether anything reads through it.
  public static useToggleReplicaReads(client: ApiClient) {
    return useAppMutation<{ ok: true }, ReplicaToggleInput>({
      mutationFn: (input) => client.platform.updateReplicaSwitch(input),
      invalidates: [QueryKeys.platform.status(), QueryKeys.platform.policy()],
    });
  }

  // A plan edit changes what every org on it may do, so every org's panel is stale.
  public static useSavePlan(client: ApiClient) {
    return useAppMutation<{ ok: true }, PlanSaveInput>({
      mutationFn: (input) => client.platform.savePlan(input),
      invalidates: [QueryKeys.platform.plans(), QueryKeys.platform.entitlements()],
    });
  }

  public static useDeletePlan(client: ApiClient) {
    return useAppMutation<{ ok: true }, PlanRefInput>({
      mutationFn: (input) => client.platform.deletePlan(input),
      invalidates: [QueryKeys.platform.plans()],
    });
  }

  public static useUpdateDefaultPlan(client: ApiClient) {
    return useAppMutation<{ ok: true }, PlanRefInput>({
      mutationFn: (input) => client.platform.updateDefaultPlan(input),
      invalidates: [QueryKeys.platform.plans()],
    });
  }

  // The plan list too: it counts the orgs on each plan, and this moved one.
  public static useAssignPlan(client: ApiClient) {
    return useAppMutation<{ ok: true }, PlanAssignInput>({
      mutationFn: (input) => client.platform.assignPlan(input),
      invalidates: [QueryKeys.platform.entitlements(), QueryKeys.platform.plans()],
    });
  }

  public static useAdjustEntitlement(client: ApiClient) {
    return useAppMutation<AdjustedDto, AdjustmentSaveInput>({
      mutationFn: (input) => client.platform.adjustEntitlement(input),
      invalidates: [QueryKeys.platform.entitlements()],
    });
  }

  public static useClearAdjustment(client: ApiClient) {
    return useAppMutation<{ ok: true }, AdjustmentClearInput>({
      mutationFn: (input) => client.platform.clearAdjustment(input),
      invalidates: [QueryKeys.platform.entitlements()],
    });
  }

  // The member lists too: the tenant shows the suspend on its own list (`AX6.7`).
  public static useSuspendAccount(client: ApiClient) {
    return useAppMutation<{ ok: true }, AccountSuspensionInput>({
      mutationFn: (input) => client.platform.suspendAccount(input),
      invalidates: [QueryKeys.platform.accounts(), QueryKeys.member.all()],
    });
  }

  public static useReinstateAccount(client: ApiClient) {
    return useAppMutation<{ ok: true }, AccountSuspensionInput>({
      mutationFn: (input) => client.platform.reinstateAccount(input),
      invalidates: [QueryKeys.platform.accounts(), QueryKeys.member.all()],
    });
  }

  public static useDenyAccountPermission(client: ApiClient) {
    return useAppMutation<AdjustedDto, AccountDenySaveInput>({
      mutationFn: (input) => client.platform.denyAccountPermission(input),
      invalidates: [QueryKeys.platform.accounts(), QueryKeys.override.all()],
    });
  }

  public static useClearAccountDeny(client: ApiClient) {
    return useAppMutation<{ ok: true }, AccountDenyClearInput>({
      mutationFn: (input) => client.platform.clearAccountDeny(input),
      invalidates: [QueryKeys.platform.accounts(), QueryKeys.override.all()],
    });
  }

  // Every org's panel as well: a switched-off module masks keys for all of them.
  public static useUpdateModuleSwitch(client: ApiClient) {
    return useAppMutation<{ ok: true }, ModuleSwitchUpdateInput>({
      mutationFn: (input) => client.platform.updateModuleSwitch(input),
      invalidates: [QueryKeys.platform.modules(), QueryKeys.platform.entitlements()],
    });
  }

  public static useUpdateFlag(client: ApiClient) {
    return useAppMutation<{ ok: true }, FlagToggleInput>({
      mutationFn: (input) => client.platform.updateFlag(input),
      invalidates: [QueryKeys.platform.flags()],
    });
  }

  public static useUpdateFlagTarget(client: ApiClient) {
    return useAppMutation<{ ok: true }, FlagTargetToggleInput>({
      mutationFn: (input) => client.platform.updateFlagTarget(input),
      invalidates: [QueryKeys.platform.flags()],
    });
  }

  // The list carries what the store currently holds, so a save that failed after the
  // commit shows as drift rather than as success.
  public static useUpdateProjection(client: ApiClient) {
    return useAppMutation<{ ok: true }, ProjectionUpdateInput>({
      mutationFn: (input) => client.platform.updateProjection(input),
      invalidates: [QueryKeys.platform.projection()],
    });
  }

  // Invalidates nothing: a restore queues a job, and what it changes is a scratch table
  // no read on this screen looks at. The job id in the response is the whole answer.
  public static useRestorePartition(client: ApiClient) {
    return useAppMutation<RestoreRequestedDto, RestoreInput>({
      mutationFn: (input) => client.platform.restorePartition(input),
      invalidates: [],
    });
  }
}
