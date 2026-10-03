import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

const trigger = z.enum(["push", "schedule", "manual", "upload"]);

// What the notification policies read: who to tell and what to say, not the graph.
export const scanEvents = {
  "scan.succeeded": z.object({
    projectId: Identifiers.projectId,
    scanId: Identifiers.scanId,
    trigger,
    requestedBy: Identifiers.userId.nullable(),
    newFindings: z.number().int().nonnegative(),
  }),
  "scan.failed": z.object({
    projectId: Identifiers.projectId,
    scanId: Identifiers.scanId,
    trigger,
    requestedBy: Identifiers.userId.nullable(),
    error: z.string().max(500),
  }),
  "finding.created": z.object({
    projectId: Identifiers.projectId,
    scanId: Identifiers.scanId,
    kind: z.enum(["cycle", "unguarded_route"]),
    key: z.string().max(2_000),
  }),
} as const;
