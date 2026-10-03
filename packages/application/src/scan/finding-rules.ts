import type { GraphDocument, ScanCounts } from "../import.js";
import type { FindingKey } from "./scan.repository.js";

// What a completed graph says, as the summary Postgres keeps and the findings it tracks.
export class FindingRules {
  private constructor() {}

  // Long enough to name any real cycle; a key past it is truncated, still unique enough.
  private static readonly MAX_KEY = 2_000;

  public static counts(document: GraphDocument): ScanCounts {
    return {
      files: document.files.length,
      imports: document.edges.filter((edge) => edge.kind === "import").length,
      resolved: document.coverage.resolved,
      total: document.coverage.total,
      routes: document.routes.length,
      cycles: document.insights.cycles.length,
      unguarded: document.insights.unguardedRoutes.length,
      unusedFiles: document.insights.unusedFiles.length,
    };
  }

  // A cycle is keyed by its sorted members, so the same cycle found again is not new.
  public static findings(document: GraphDocument): FindingKey[] {
    const cycles = document.insights.cycles.map((cycle) => ({
      kind: "cycle" as const,
      key: [...cycle].sort().join(" → ").slice(0, FindingRules.MAX_KEY),
    }));
    const routes = document.insights.unguardedRoutes.map((id) => ({
      kind: "unguarded_route" as const,
      key: id,
    }));
    return [...cycles, ...routes];
  }

  public static diff(before: readonly FindingKey[], after: readonly FindingKey[]) {
    const id = (finding: FindingKey) => `${finding.kind}\u0000${finding.key}`;
    const was = new Set(before.map(id));
    const is = new Set(after.map(id));
    return {
      added: after.filter((finding) => !was.has(id(finding))),
      removed: before.filter((finding) => !is.has(id(finding))),
    };
  }
}
