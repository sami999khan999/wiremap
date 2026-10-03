import type { OrganizationId } from "../import.js";

export interface OrganizationRecord {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly isPlatform: boolean;
  readonly createdAt: Date;
}

// The tenant row as its own settings page reads and writes it. The slug never changes:
// it is what a delete is confirmed by, and links outside the product may hold it.
export abstract class OrganizationRepository {
  public abstract findById(organizationId: OrganizationId): Promise<OrganizationRecord | null>;

  public abstract rename(organizationId: OrganizationId, name: string): Promise<void>;
}
