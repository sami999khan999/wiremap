import type { CapabilitySet, PermissionKey, ReactNode } from "../import.js";

export interface CanProps {
  readonly permission: PermissionKey;
  readonly capabilities: CapabilitySet;
  // The permission *scope* id, spelled as the kernel spells it: it reads like a domain
  // noun and is not one, so renaming it would hide the pass-through.
  readonly goalId?: string;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

// A convenience, never the gate: hiding a button is a UX affordance, and the real check
// is `Authorizer.assert()` in the use-case. Same `can()` as the server calls.
export function Can({
  permission,
  capabilities,
  goalId,
  children,
  fallback = null,
}: CanProps): ReactNode {
  // Bare rather than wrapped: both branches are already `ReactNode`, and the wrapper is
  // what `noUselessFragments` objects to.
  return capabilities.can(permission, goalId) ? children : fallback;
}
