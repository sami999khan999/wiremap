import { type CapabilitiesDto, CapabilitySet, PermissionRegistry } from "../import.js";

// The API returns raw strings, as `RoleMatrix` also receives them: a permission the
// catalog no longer knows is a stale row, and this is where it stops being trusted.
export function capabilitiesFromWire(dto: CapabilitiesDto): CapabilitySet {
  const registry = PermissionRegistry.instance;
  const scoped = (set: CapabilitiesDto["org"]) => ({
    grants: set.grants.filter((key) => registry.isKnown(key)),
    denies: set.denies.filter((key) => registry.isKnown(key)),
  });

  return CapabilitySet.from({
    wildcard: dto.wildcard,
    org: scoped(dto.org),
    goals: Object.fromEntries(Object.entries(dto.goals).map(([id, set]) => [id, scoped(set)])),
  });
}
