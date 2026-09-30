import type { OrganizationId, UserId } from "../import.js";

// Creates a tenant and makes one person its owner. One implementation, because a second
// copy of the seed-and-own logic would be a second permission model.
export abstract class OrganizationFounder {
  // Optional, and derived from the new id when absent. On the port because the personal
  // enroller passes one, and a port its caller must bypass is one the container bypasses.
  public abstract found(userId: UserId, name: string, slug?: string): Promise<OrganizationId>;
}
