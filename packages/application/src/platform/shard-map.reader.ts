import type { OrganizationId } from "../import.js";

export interface ShardTenant {
  readonly organizationId: OrganizationId;
  readonly slug: string;
  readonly name: string;
  readonly node: number;
  readonly assignedAt: Date;
  readonly movedAt: Date | null;
}

// The directory as an operator reads it. A catalog read: the directory is what says
// where a tenant is, so it cannot be routed by one. The big kit adds the node listing.
export abstract class ShardMapReader {
  // An organization id or a slug, whichever the operator is holding. Null is "nothing
  // answers to that", which is a normal answer to a typed search rather than an error.
  public abstract findByTerm(term: string): Promise<ShardTenant | null>;
}
