import type { OrganizationId, UserId } from "../import.js";

// The write side of the capability cache. A use-case that changes what someone is
// allowed to do must call this, or the old answer keeps being given until the TTL.
export abstract class CapabilityInvalidator {
  public abstract invalidate(organizationId: OrganizationId, userId: UserId): Promise<void>;

  // A role edit affects every holder, and the holders are not known here. Cheaper to
  // flush the tenant than to enumerate them, and never wider than the tenant.
  public abstract invalidateOrganization(organizationId: OrganizationId): Promise<void>;

  // The third axis is cached under its own key, so flushing a tenant does not reach it.
  // Called by the adapter when the tenant being flushed *is* the platform one.
  public abstract invalidatePlatform(): Promise<void>;

  // Every tenant at once: a plan edit or the kill switch changes what every holder of a
  // plan may do, and the holders are not known here. The platform axis is never masked.
  public abstract invalidateAll(): Promise<void>;
}
