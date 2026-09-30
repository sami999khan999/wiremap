import type {
  ApiClient,
  ChangeRolePermissionInput,
  CreateRoleInput,
  DeleteRoleInput,
  RoleDto,
  UpdateRoleInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Static hook factories: the hook rules apply at the call site, and each is called
// unconditionally at the top of a component.
export class RoleMutations {
  private constructor() {}

  public static useCreate(client: ApiClient) {
    return useAppMutation<RoleDto, CreateRoleInput>({
      mutationFn: (input) => client.role.create(input),
      invalidates: [QueryKeys.rbac.all()],
    });
  }

  public static useUpdate(client: ApiClient) {
    return useAppMutation<RoleDto, UpdateRoleInput>({
      mutationFn: (input) => client.role.update(input),
      invalidates: [QueryKeys.rbac.all()],
    });
  }

  public static useDelete(client: ApiClient) {
    return useAppMutation<{ ok: true }, DeleteRoleInput>({
      mutationFn: (input) => client.role.remove(input),
      invalidates: [QueryKeys.rbac.all()],
    });
  }

  // `member.all()` too: a member row renders its role's name, and the effective set the
  // inspector shows is resolved from the grants this changes.
  public static useGrant(client: ApiClient) {
    return useAppMutation<RoleDto, ChangeRolePermissionInput>({
      mutationFn: (input) => client.role.grant(input),
      invalidates: [QueryKeys.rbac.all(), QueryKeys.member.all()],
    });
  }

  public static useRevoke(client: ApiClient) {
    return useAppMutation<RoleDto, ChangeRolePermissionInput>({
      mutationFn: (input) => client.role.revoke(input),
      invalidates: [QueryKeys.rbac.all(), QueryKeys.member.all()],
    });
  }
}
