export {
  CapabilitySet,
  type CapabilitySetDto,
  CORE_MODULE,
  type EntitlementInput,
  EntitlementMask,
  type ScopedSetDto,
} from "./capability/index.js";
export { CATALOG } from "./catalog/index.js";
export { FLAGS } from "./flag/index.js";
export { GATES } from "./gate/index.js";
export {
  type FlagKey,
  type FlagMeta,
  FlagRegistry,
  type ModuleGate,
  type ModuleKey,
  ModuleRegistry,
  type PermissionKey,
  type PermissionMeta,
  PermissionRegistry,
  type PermissionScope,
} from "./registry/index.js";
export {
  type AppRoute,
  PLATFORM_ROUTE_PERMISSION,
  ROUTES,
  type RoutePath,
} from "./route/index.js";
