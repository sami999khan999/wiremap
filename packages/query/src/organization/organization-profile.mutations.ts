import type {
  ApiClient,
  OrganizationDto,
  RemoveOrganizationInput,
  TransferOwnershipInput,
  UpdateOrganizationInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// The session snapshot carries the organization's name and the caller's role, so the
// call site refreshes the session after each of these; the cache here covers the rest.

export class OrganizationProfileMutations {
  private constructor() {}

  public static useUpdate(client: ApiClient) {
    return useAppMutation<OrganizationDto, UpdateOrganizationInput>({
      mutationFn: (input) => client.organization.update(input),
      invalidates: [QueryKeys.organization.all()],
    });
  }

  public static useTransferOwnership(client: ApiClient) {
    return useAppMutation<{ ok: true }, TransferOwnershipInput>({
      mutationFn: (input) => client.organization.transferOwnership(input),
      invalidates: [QueryKeys.organization.all(), QueryKeys.member.all(), QueryKeys.rbac.all()],
    });
  }

  public static useRemove(client: ApiClient) {
    return useAppMutation<{ ok: true }, RemoveOrganizationInput>({
      mutationFn: (input) => client.organization.remove(input),
      invalidates: [QueryKeys.organization.all()],
    });
  }
}
