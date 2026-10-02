import { useCapabilities } from "../auth/index.js";
import {
  type PermissionKey,
  type RoleDto,
  RoleQueries,
  useApiClient,
  useAppQuery,
  useMemo,
} from "../import.js";

export interface AssignableRoles {
  // Every role of this organization, for naming a member's current one.
  readonly all: readonly RoleDto[];
  // Membership roles the viewer may hand out: not goal-scoped, and no key they lack.
  readonly assignable: readonly RoleDto[];
  // Whether the viewer may move someone off, or switch off, a member holding this role.
  readonly canAct: (role: RoleDto | undefined) => boolean;
  readonly isPending: boolean;
}

// The pickers' half of `RoleRules.assertAssignableBy`, through the same `cannotAssign`, so
// a role the server would refuse is never offered. The server stays the gate.
export function useAssignableRoles(): AssignableRoles {
  const client = useApiClient();
  const capabilities = useCapabilities();
  const roles = useAppQuery(RoleQueries.list(client, { limit: 100, offset: 0 }));
  const entitlement = useAppQuery(RoleQueries.entitlement(client));

  return useMemo<AssignableRoles>(() => {
    const all: readonly RoleDto[] = roles.data?.items ?? [];
    // Until the plan loads every key counts, which errs towards offering and letting the
    // server refuse rather than hiding a role that is assignable.
    const keys = entitlement.data?.keys;
    const entitled = keys ? new Set<string>(keys) : null;
    const isEntitled = (key: PermissionKey) => entitled?.has(key) ?? true;
    const allowed = (role: RoleDto) =>
      capabilities.cannotAssign(role.permissions, isEntitled) === null;

    return {
      all,
      assignable: all.filter((role) => role.scope !== "goal" && allowed(role)),
      canAct: (role) => (role ? allowed(role) : false),
      isPending: roles.isPending,
    };
  }, [roles.data, roles.isPending, entitlement.data, capabilities]);
}
