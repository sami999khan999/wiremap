import type { CapabilitySet, OrganizationId, PermissionKey, UserId } from "../import.js";

export type PrincipalKind = "user" | "api_key" | "system";

// Four credential types — a browser cookie, a desktop bearer token, an integration's
// API key, and the worker's scheduled run — collapse into one shape before any use-case.
export class Principal {
  public constructor(
    public readonly organizationId: OrganizationId,
    public readonly userId: UserId,
    public readonly capabilities: CapabilitySet,
    public readonly kind: PrincipalKind = "user",
  ) {}

  // An API key is a principal whose capabilities cannot exceed its issuer's.
  public static apiKey(
    organizationId: OrganizationId,
    issuerId: UserId,
    caps: CapabilitySet,
  ): Principal {
    return new Principal(organizationId, issuerId, caps, "api_key");
  }

  // The worker's actor for scheduled work. Given an explicit, narrow capability set —
  // never a wildcard. A job that can do anything eventually does something it shouldn't.
  public static system(organizationId: OrganizationId, id: UserId, caps: CapabilitySet): Principal {
    return new Principal(organizationId, id, caps, "system");
  }

  public can(permission: PermissionKey, goalId?: string): boolean {
    return this.capabilities.can(permission, goalId);
  }

  public canTenantWide(permission: PermissionKey): boolean {
    return this.capabilities.canTenantWide(permission);
  }
}
