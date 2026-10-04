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
  GithubAppFormDto,
  GithubAppStartInput,
  ModuleSwitchUpdateInput,
  PlanAssignInput,
  PlanRefInput,
  PlanSaveInput,
  ReplicaToggleInput,
  TenantDeleteInput,
  TenantExportInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class PlatformMutations {
  private constructor() {}

  // `all()`: a deleted tenant leaves every platform read that could name it, the
  // entitlement and account lookups included.
  public static useDeleteTenant(client: ApiClient) {
    return useAppMutation<DeleteRequestedDto, TenantDeleteInput>({
      mutationFn: (input) => client.platform.deleteTenant(input),
      invalidates: [QueryKeys.platform.all()],
    });
  }

  // Invalidates nothing: the job has only been queued, so refetching the list now would
  // show the objects the last export wrote.
  public static useExportTenant(client: ApiClient) {
    return useAppMutation<ExportRequestedDto, TenantExportInput>({
      mutationFn: (input) => client.platform.exportTenant(input),
      invalidates: [],
    });
  }

  // The status key, because that is where the switch is read: the page showing the lag
  // is the one that says whether anything reads through it.
  public static useToggleReplicaReads(client: ApiClient) {
    return useAppMutation<{ ok: true }, ReplicaToggleInput>({
      mutationFn: (input) => client.platform.updateReplicaSwitch(input),
      invalidates: [QueryKeys.platform.status()],
    });
  }

  // Invalidates nothing: the App exists only once GitHub sends the person back.
  public static useStartGithubApp(client: ApiClient) {
    return useAppMutation<GithubAppFormDto, GithubAppStartInput>({
      mutationFn: (input) => client.platform.startGithubApp(input),
    });
  }

  public static useRemoveGithubApp(client: ApiClient) {
    return useAppMutation<{ ok: true }, void>({
      mutationFn: () => client.platform.removeGithubApp(),
      invalidates: [QueryKeys.platform.githubApp()],
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
}
