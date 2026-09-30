import type { PermissionKey } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository } from "./capability.repository.js";

// The org's ceiling, as the role editor shows it: a key outside it is greyed rather than
// hidden, so an admin sees what a plan change would bring back. Read under `rbac.role.read`.
export class GetEntitlementUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly capabilities: CapabilityRepository,
  ) {}

  public async execute(actor: Principal): Promise<readonly PermissionKey[]> {
    this.authorizer.assert(actor, "rbac.role.read");
    return (await this.capabilities.entitlementFor(actor.organizationId)).keys();
  }
}
