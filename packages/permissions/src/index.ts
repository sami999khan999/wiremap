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
  type DismissibleWidgetKey,
  type FlagKey,
  type FlagMeta,
  FlagRegistry,
  type InlineWidgetKey,
  type InlineWidgetMeta,
  type ModuleGate,
  type ModuleKey,
  ModuleRegistry,
  type PermissionKey,
  type PermissionMeta,
  PermissionRegistry,
  type PermissionScope,
  type WidgetFacts,
  type WidgetKey,
  type WidgetMeta,
  type WidgetPolicy,
  WidgetRegistry,
  type WidgetVisibility,
  ZONES,
  type ZoneKey,
  type ZoneWidgetKey,
  type ZoneWidgetMeta,
} from "./registry/index.js";
export { type AppRoute, ROUTES, type RoutePath } from "./route/index.js";
export { WIDGETS } from "./widget/index.js";
