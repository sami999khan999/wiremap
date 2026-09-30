import { ForbiddenError, type PermissionKey } from "../import.js";
import type { Principal } from "./principal.js";

// The gate. Transport middleware is bypassed by the worker and by SSR direct calls;
// this is not, which is why authorization lives in the use-case and not in a filter.
export class Authorizer {
  public assert(principal: Principal, permission: PermissionKey, goalId?: string): void {
    if (!principal.can(permission, goalId)) {
      throw new ForbiddenError(permission, goalId);
    }
  }

  public assertAll(
    principal: Principal,
    permissions: readonly PermissionKey[],
    goalId?: string,
  ): void {
    for (const permission of permissions) this.assert(principal, permission, goalId);
  }
}
