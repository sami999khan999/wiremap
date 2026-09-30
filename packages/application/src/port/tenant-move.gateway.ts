import type { OrganizationId } from "../import.js";

export interface TableRowCount {
  readonly table: string;
  readonly rows: number;
}

// **The one seam that addresses two nodes at once**, which is why it is not a
// `BaseRepository`: a repository reads tables of one placement, on one node.
export abstract class TenantMoveGateway {
  // Waits out every writer that read its placement before the freeze. A request places
  // itself once, so one that resolved a moment earlier can still write to the source.
  public abstract quiesce(organizationId: OrganizationId, node: number): Promise<void>;

  // The target's partitions, every month the source holds, then its routed rows emptied:
  // a retry starts from nothing, never from a stale copy a failed attempt left behind.
  public abstract prepare(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<void>;

  // Page in, page out. Portable over a managed Postgres, where `postgres_fdw` and a
  // node-to-node credential are not — decision `24.2`.
  public abstract copy(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<readonly TableRowCount[]>;

  // Counted on one node, so the caller can compare two answers rather than trusting
  // the copy's own tally of what it thinks it wrote.
  public abstract counts(
    organizationId: OrganizationId,
    node: number,
  ): Promise<readonly TableRowCount[]>;

  // Audit rows the source took after `since`, onto the target, before the source goes.
  // A catalog write between the verify and the flip lands on node 0 and nowhere else.
  public abstract carryAudit(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
    since: Date,
  ): Promise<number>;

  // The source rows, once the grace period is over. One statement per table and never
  // `CASCADE`, for the reason `dropTenantPartitions` gives.
  public abstract dropOn(organizationId: OrganizationId, node: number): Promise<readonly string[]>;
}
