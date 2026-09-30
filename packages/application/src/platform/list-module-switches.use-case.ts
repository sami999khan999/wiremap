import type { Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import { EntitlementRules } from "./entitlement.rules.js";

export interface ModuleSwitch {
  readonly module: string;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly disabledAt: Date | null;
}

// Every module the kill switch reaches, on or off. Read under `platform.status.read`: which
// modules are down is status, and the people reading status are the ones asking.
export class ListModuleSwitchesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
  ) {}

  public async execute(actor: Principal): Promise<readonly ModuleSwitch[]> {
    this.authorizer.assert(actor, "platform.status.read");

    const disabled = new Map(
      (await this.entitlements.findDisabledModules()).map((row) => [row.module, row]),
    );

    return EntitlementRules.switchable().map((module) => {
      const row = disabled.get(module);
      return {
        module,
        enabled: !row,
        reason: row?.reason ?? null,
        disabledAt: row?.disabledAt ?? null,
      };
    });
  }
}
