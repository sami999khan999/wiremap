import {
  and,
  count,
  desc,
  eq,
  type FindingKey,
  inArray,
  type NewScan,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  type ProjectId,
  type ScanCounts,
  type ScanId,
  type ScanRecord,
  type ScanRepository,
  type ScanState,
  type SweptScan,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { scanFindings, scans } from "../schema/index.js";

type ScanRow = typeof scans.$inferSelect;

export class PgScanRepository extends BaseRepository implements ScanRepository {
  // A tenant's own rows, on the tenant's node.
  protected override readonly placement: Placement = "routed";

  public async create(organizationId: OrganizationId, scan: NewScan): Promise<void> {
    await this.db.insert(scans).values({
      ...scan,
      organizationId,
      ...(scan.state === "running" ? { startedAt: sql`now()` } : {}),
    });
  }

  public async findById(organizationId: OrganizationId, id: ScanId): Promise<ScanRecord | null> {
    const [row] = await this.db
      .select()
      .from(scans)
      .where(and(eq(scans.organizationId, organizationId), eq(scans.id, id)))
      .limit(1);
    return row ? PgScanRepository.record(row) : null;
  }

  public async list(
    organizationId: OrganizationId,
    projectId: ProjectId,
    page: PaginationQuery,
  ): Promise<{ readonly items: readonly ScanRecord[]; readonly total: number }> {
    const where = and(eq(scans.organizationId, organizationId), eq(scans.projectId, projectId));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(scans)
        .where(where)
        .orderBy(desc(scans.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(scans).where(where),
    ]);
    return { items: rows.map((row) => PgScanRepository.record(row)), total: totals[0]?.total ?? 0 };
  }

  public async active(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ScanRecord | null> {
    const [row] = await this.db
      .select()
      .from(scans)
      .where(
        and(
          eq(scans.organizationId, organizationId),
          eq(scans.projectId, projectId),
          inArray(scans.state, ["queued", "running"]),
        ),
      )
      .orderBy(desc(scans.createdAt))
      .limit(1);
    return row ? PgScanRepository.record(row) : null;
  }

  public async latestSucceeded(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ScanRecord | null> {
    const [row] = await this.db
      .select()
      .from(scans)
      .where(
        and(
          eq(scans.organizationId, organizationId),
          eq(scans.projectId, projectId),
          eq(scans.state, "succeeded"),
        ),
      )
      .orderBy(desc(scans.createdAt))
      .limit(1);
    return row ? PgScanRepository.record(row) : null;
  }

  public start(organizationId: OrganizationId, id: ScanId, at: Date): Promise<boolean> {
    return this.move(organizationId, id, ["queued"], { state: "running", startedAt: at });
  }

  public succeed(
    organizationId: OrganizationId,
    id: ScanId,
    result: {
      readonly at: Date;
      readonly graphKey: string;
      readonly graphBytes: number;
      readonly counts: ScanCounts;
      readonly analyzerVersion: string;
      readonly commitSha: string | null;
    },
  ): Promise<boolean> {
    return this.move(organizationId, id, ["running"], {
      state: "succeeded",
      finishedAt: result.at,
      graphKey: result.graphKey,
      graphBytes: result.graphBytes,
      counts: result.counts,
      analyzerVersion: result.analyzerVersion,
      commitSha: result.commitSha,
    });
  }

  public fail(
    organizationId: OrganizationId,
    id: ScanId,
    at: Date,
    error: string,
  ): Promise<boolean> {
    return this.move(organizationId, id, ["queued", "running"], {
      state: "failed",
      finishedAt: at,
      error,
    });
  }

  // Across tenants on this node, on `scans_stale_idx`: only live scans are in it.
  public async failStale(before: Date, at: Date, error: string): Promise<readonly SweptScan[]> {
    const rows = await this.db
      .update(scans)
      .set({ state: "failed", finishedAt: at, error })
      .where(and(inArray(scans.state, ["queued", "running"]), sql`${scans.createdAt} < ${before}`))
      .returning({
        organizationId: scans.organizationId,
        id: scans.id,
        projectId: scans.projectId,
        trigger: scans.trigger,
        requestedBy: scans.requestedBy,
      });
    return rows;
  }

  public async openFindings(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly FindingKey[]> {
    return this.db
      .select({ kind: scanFindings.kind, key: scanFindings.key })
      .from(scanFindings)
      .where(
        and(eq(scanFindings.organizationId, organizationId), eq(scanFindings.projectId, projectId)),
      );
  }

  public async replaceFindings(
    organizationId: OrganizationId,
    projectId: ProjectId,
    scanId: ScanId,
    change: { readonly added: readonly FindingKey[]; readonly removed: readonly FindingKey[] },
  ): Promise<void> {
    for (const finding of change.removed) {
      await this.db
        .delete(scanFindings)
        .where(
          and(
            eq(scanFindings.organizationId, organizationId),
            eq(scanFindings.projectId, projectId),
            eq(scanFindings.kind, finding.kind),
            eq(scanFindings.key, finding.key),
          ),
        );
    }
    if (change.added.length === 0) return;
    await this.db
      .insert(scanFindings)
      .values(change.added.map((finding) => ({ ...finding, organizationId, projectId, scanId })))
      .onConflictDoNothing();
  }

  // A transition from named states only, so a late callback cannot move a finished scan.
  private async move(
    organizationId: OrganizationId,
    id: ScanId,
    from: readonly ScanState[],
    change: Partial<typeof scans.$inferInsert>,
  ): Promise<boolean> {
    const moved = await this.db
      .update(scans)
      .set(change)
      .where(
        and(
          eq(scans.organizationId, organizationId),
          eq(scans.id, id),
          inArray(scans.state, [...from]),
        ),
      )
      .returning({ id: scans.id });
    return moved.length > 0;
  }

  private static record(row: ScanRow): ScanRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      trigger: row.trigger,
      state: row.state,
      branch: row.branch,
      commitSha: row.commitSha,
      requestedBy: row.requestedBy,
      queuedAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      error: row.error,
      graphKey: row.graphKey,
      graphBytes: row.graphBytes,
      counts: row.counts,
      analyzerVersion: row.analyzerVersion,
    };
  }
}
