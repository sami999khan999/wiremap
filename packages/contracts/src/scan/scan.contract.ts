import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

export const SCAN_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const SCAN_TRIGGERS = ["push", "schedule", "manual", "upload"] as const;

// The summary Postgres keeps of a graph; the graph itself is a file in storage.
const counts = z.object({
  files: z.number().int().nonnegative(),
  imports: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  routes: z.number().int().nonnegative(),
  cycles: z.number().int().nonnegative(),
  unguarded: z.number().int().nonnegative(),
  unusedFiles: z.number().int().nonnegative(),
});

export class ScanContract {
  private constructor() {}

  public static readonly counts = counts;

  public static readonly entity = z.object({
    id: Identifiers.scanId,
    projectId: Identifiers.projectId,
    trigger: z.enum(SCAN_TRIGGERS),
    state: z.enum(SCAN_STATES),
    branch: z.string().nullable(),
    commitSha: z.string().nullable(),
    requestedBy: Identifiers.userId.nullable(),
    queuedAt: z.date(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    // A runner's own words, capped, never a stack: shown to anyone who can read the project.
    error: z.string().nullable(),
    counts: counts.nullable(),
    analyzerVersion: z.string().nullable(),
  });

  public static readonly listQuery = Pagination.query.extend({ projectId: Identifiers.projectId });

  public static readonly run = z.object({
    projectId: Identifiers.projectId,
    // A branch to scan instead of each repository's default.
    branch: z.string().trim().min(1).max(255).nullable(),
  });

  // The CLI's upload: a scan made for a graph it already built, and where to put the file.
  public static readonly createUpload = z.object({
    project: z.string().min(2).max(48),
    branch: z.string().trim().min(1).max(255).nullable(),
    commitSha: z.string().trim().max(64).nullable(),
  });

  public static readonly upload = z.object({
    scanId: Identifiers.scanId,
    // `<organizationId>.<scanId>`: what the runner protocol's URLs carry.
    ref: z.string(),
    token: z.string(),
    uploadUrl: z.url(),
    completeUrl: z.url(),
  });

  public static readonly graphQuery = z.object({
    projectId: Identifiers.projectId,
    // Null or absent: the latest that succeeded. A GET in the public API cannot send `null`.
    scanId: Identifiers.scanId.nullable().default(null),
  });

  // A short-lived signed URL to the gzipped `GraphDocument`; immutable, so cached by scan id.
  public static readonly graph = z.object({
    scanId: Identifiers.scanId,
    url: z.url(),
    createdAt: z.date(),
    counts,
  });
}

export type ScanDto = z.infer<typeof ScanContract.entity>;
export type ScanCounts = z.infer<typeof ScanContract.counts>;
export type ScanState = (typeof SCAN_STATES)[number];
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];
export type ScanListQuery = z.infer<typeof ScanContract.listQuery>;
export type RunScanInput = z.infer<typeof ScanContract.run>;
export type CreateScanUploadInput = z.infer<typeof ScanContract.createUpload>;
export type ScanUploadDto = z.infer<typeof ScanContract.upload>;
export type GraphQueryInput = z.infer<typeof ScanContract.graphQuery>;
export type GraphLinkDto = z.infer<typeof ScanContract.graph>;
