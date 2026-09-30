import type { OrganizationId, PaginationQuery } from "../import.js";

// One tenant's cold footprint, one row per table. Cold only — hot bytes are per table
// and live on the retention screen.
export interface TenantStorageRow {
  readonly organizationId: OrganizationId;
  // Null for a tenant that has been deleted: the archive outlives it by design, and a
  // row whose name resolved to nothing is exactly what an operator is looking for.
  readonly organizationName: string | null;
  readonly tableName: string;
  readonly bytes: number;
  readonly rows: number;
  readonly months: number;
}

export interface TenantStoragePage {
  readonly items: readonly TenantStorageRow[];
  readonly total: number;
}

// One archived tenant-month, for the drill-down.
export interface TenantStorageMonth {
  readonly tableName: string;
  readonly period: string;
  readonly bytes: number;
  readonly rows: number;
  readonly actionCounts: Readonly<Record<string, number>>;
  readonly projectedAt: Date | null;
}

export abstract class TenantStorageReader {
  // Sorted by bytes descending. `organizationId` narrows the read rather than
  // filtering a page already cut to a limit, which would return fewer rows.
  public abstract byTenant(
    page: PaginationQuery,
    organizationId: OrganizationId | null,
  ): Promise<TenantStoragePage>;

  // The per-month rows and their per-action breakdown, for one tenant. Unpaginated:
  // it is months × retired tables, which is bounded by the retention policy itself.
  public abstract monthsFor(organizationId: OrganizationId): Promise<readonly TenantStorageMonth[]>;
}
