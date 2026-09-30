import type {
  ApiClient,
  ClearOverrideInput,
  DenyOverrideInput,
  GrantOverrideInput,
  OverrideWrittenDto,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Every write moves three reads: the person's exceptions, the member list's count of them,
// and the inspector's answer. The role list counts members with exceptions too.
const MOVED = [QueryKeys.override.all(), QueryKeys.member.all(), QueryKeys.rbac.all()] as const;

export class OverrideMutations {
  private constructor() {}

  public static useGrant(client: ApiClient) {
    return useAppMutation<OverrideWrittenDto, GrantOverrideInput>({
      mutationFn: (input) => client.override.grant(input),
      invalidates: MOVED,
    });
  }

  public static useDeny(client: ApiClient) {
    return useAppMutation<OverrideWrittenDto, DenyOverrideInput>({
      mutationFn: (input) => client.override.deny(input),
      invalidates: MOVED,
    });
  }

  public static useClear(client: ApiClient) {
    return useAppMutation<{ ok: true }, ClearOverrideInput>({
      mutationFn: (input) => client.override.clear(input),
      invalidates: MOVED,
    });
  }
}
