import type { OrganizationId, PaginationQuery } from "../import.js";

// One physical node, counted out of `shard_assignments`. A node the deployment has just
// added holds nothing and so has no row — which is the honest answer, not a zero.
export interface ShardNode {
  readonly node: number;
  readonly tenants: number;
  readonly lastAssignedAt: Date;
  // Null until something on this node has been moved. `moved_at` is stamped only when
  // the node actually changes, so this reads "when did this node last receive one".
  readonly lastMovedAt: Date | null;
}

export interface ShardTenant {
  readonly organizationId: OrganizationId;
  readonly slug: string;
  readonly name: string;
  readonly node: number;
  readonly assignedAt: Date;
  readonly movedAt: Date | null;
  // How many tables this tenant overrides, not the numbers themselves. The numbers are
  // the retention screen's; the count is what says whether to go there.
  readonly retentionOverrides: number;
}

export interface ShardTenantPage {
  readonly items: readonly ShardTenant[];
  readonly total: number;
}

// The directory as an operator reads it. Every method here is a catalog read: the
// directory is what says where a tenant is, so it cannot be routed by one.
export abstract class ShardMapReader {
  public abstract nodes(): Promise<readonly ShardNode[]>;

  // One node's tenants, paginated. Never every node's at once — that is the whole
  // directory, and it is the one read this screen must not make.
  public abstract tenantsOn(node: number, page: PaginationQuery): Promise<ShardTenantPage>;

  // An organization id or a slug, whichever the operator is holding. Null is "nothing
  // answers to that", which is a normal answer to a typed search rather than an error.
  public abstract findByTerm(term: string): Promise<ShardTenant | null>;
}
