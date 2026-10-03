import type {
  OrganizationId,
  PaginationQuery,
  ProjectId,
  ScanCounts,
  ScanId,
  ScanState,
  ScanTrigger,
  UserId,
} from "../import.js";

export interface ScanRecord {
  readonly id: ScanId;
  readonly projectId: ProjectId;
  readonly trigger: ScanTrigger;
  readonly state: ScanState;
  readonly branch: string | null;
  readonly commitSha: string | null;
  readonly requestedBy: UserId | null;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly error: string | null;
  readonly graphKey: string | null;
  readonly graphBytes: number | null;
  readonly counts: ScanCounts | null;
  readonly analyzerVersion: string | null;
}

export interface NewScan {
  readonly id: ScanId;
  readonly projectId: ProjectId;
  readonly trigger: ScanTrigger;
  readonly state: "queued" | "running";
  readonly branch: string | null;
  readonly commitSha: string | null;
  readonly requestedBy: UserId | null;
}

export interface FindingKey {
  readonly kind: "cycle" | "unguarded_route";
  readonly key: string;
}

// A scan stopped by the sweep, with what the `scan.failed` event needs.
export interface SweptScan {
  readonly organizationId: OrganizationId;
  readonly id: ScanId;
  readonly projectId: ProjectId;
  readonly trigger: ScanTrigger;
  readonly requestedBy: UserId | null;
}

// Scans and a project's open findings: tenant rows, routed to the tenant's node. A scan's
// state only moves forward, and every transition says which states it moves from.
export abstract class ScanRepository {
  public abstract create(organizationId: OrganizationId, scan: NewScan): Promise<void>;

  public abstract findById(organizationId: OrganizationId, id: ScanId): Promise<ScanRecord | null>;

  public abstract list(
    organizationId: OrganizationId,
    projectId: ProjectId,
    page: PaginationQuery,
  ): Promise<{ readonly items: readonly ScanRecord[]; readonly total: number }>;

  // The queued or running scan of a project, if any: what dedupes "scan now".
  public abstract active(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ScanRecord | null>;

  public abstract latestSucceeded(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ScanRecord | null>;

  // True when the scan was queued and is now running.
  public abstract start(organizationId: OrganizationId, id: ScanId, at: Date): Promise<boolean>;

  // True when the scan was running and has now succeeded.
  public abstract succeed(
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
  ): Promise<boolean>;

  // True when the scan was queued or running and has now failed.
  public abstract fail(
    organizationId: OrganizationId,
    id: ScanId,
    at: Date,
    error: string,
  ): Promise<boolean>;

  // On this node, every scan queued or running since before `before`, failed in one go.
  public abstract failStale(before: Date, at: Date, error: string): Promise<readonly SweptScan[]>;

  // The onboarding summary Ask wrote for one scan, kept beside it rather than in a cache.
  public abstract summary(organizationId: OrganizationId, id: ScanId): Promise<string | null>;

  public abstract saveSummary(
    organizationId: OrganizationId,
    id: ScanId,
    summary: string,
  ): Promise<void>;

  // A deleted project's scans and findings, swept by the purge job.
  public abstract removeForProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void>;

  public abstract openFindings(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly FindingKey[]>;

  public abstract replaceFindings(
    organizationId: OrganizationId,
    projectId: ProjectId,
    scanId: ScanId,
    change: { readonly added: readonly FindingKey[]; readonly removed: readonly FindingKey[] },
  ): Promise<void>;
}
