import type { CapabilitySet } from "../capability/index.js";
import { GATES } from "../gate/index.js";
import type { AppRoute } from "../route/index.js";
import type { PermissionKey } from "./permission-registry.js";

export interface ModuleGate {
  readonly permission: PermissionKey;
  // `AppRoute`, not `string` — a gate pointing at an undeclared path fails to compile.
  readonly route: AppRoute;
}

export type ModuleKey = keyof typeof GATES;

export class ModuleRegistry {
  public static readonly instance = new ModuleRegistry();

  private constructor() {}

  public gate(module: ModuleKey): ModuleGate {
    return GATES[module];
  }

  public isVisible(module: ModuleKey, caps: CapabilitySet): boolean {
    return caps.can(GATES[module].permission);
  }

  public visibleModules(caps: CapabilitySet): readonly ModuleKey[] {
    return (Object.keys(GATES) as ModuleKey[]).filter((m) => this.isVisible(m, caps));
  }
}
