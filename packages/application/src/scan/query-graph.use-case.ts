import {
  type GraphDocument,
  GraphIndex,
  type GraphRoute,
  NotFoundError,
  type ProjectId,
  type ScanId,
  UnavailableError,
} from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { GraphArchive } from "./graph-archive.js";
import type { ScanRepository } from "./scan.repository.js";

interface Scope {
  readonly projectId: ProjectId;
  readonly scanId?: ScanId | undefined;
}

interface Loaded {
  readonly scanId: ScanId;
  readonly document: GraphDocument;
}

// Reads of a graph on the server, for callers that should not download and parse the whole
// file: the public API, the MCP server and the editor extension.
export class QueryGraphUseCase {
  // A graph never changes once written, so a parsed one is kept by its key. A handful is
  // enough for the requests that follow one another against the same scan.
  private static readonly KEPT = 4;
  private readonly kept = new Map<string, GraphDocument>();

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly scans: ScanRepository,
    private readonly archive: GraphArchive,
  ) {}

  public async routes(actor: Principal, input: Scope) {
    const { scanId, document } = await this.load(actor, input);
    return { scanId, routes: document.routes };
  }

  public async insights(actor: Principal, input: Scope) {
    const { scanId, document } = await this.load(actor, input);
    return {
      scanId,
      files: document.files.length,
      coverage: document.coverage,
      insights: document.insights,
    };
  }

  // Every file that reaches `path` through imports, by distance, and the routes whose
  // handler is one of them or `path` itself.
  public async impact(actor: Principal, input: Scope & { readonly path: string }) {
    const { scanId, document } = await this.load(actor, input);
    const index = GraphIndex.from(document);
    if (!index.has(input.path)) throw new NotFoundError("file", input.path);
    const dependents = index.impact(input.path);
    const touched = new Set([input.path, ...dependents.map((reached) => reached.path)]);
    const routes: readonly GraphRoute[] = document.routes.filter((route) =>
      touched.has(route.file),
    );
    return { scanId, path: input.path, dependents, routes };
  }

  private async load(actor: Principal, input: Scope): Promise<Loaded> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.graph.read",
    );
    const scan = input.scanId
      ? await this.scans.findById(actor.organizationId, input.scanId)
      : await this.scans.latestSucceeded(actor.organizationId, project.id);
    if (!scan || scan.projectId !== project.id || scan.state !== "succeeded" || !scan.graphKey) {
      throw new NotFoundError("graph", input.scanId ?? project.id);
    }

    const kept = this.kept.get(scan.graphKey);
    if (kept) return { scanId: scan.id, document: kept };
    const read = await this.archive.read(scan.graphKey);
    if ("refused" in read) throw new UnavailableError("graph");
    this.kept.set(scan.graphKey, read.document);
    if (this.kept.size > QueryGraphUseCase.KEPT) {
      const oldest = this.kept.keys().next().value;
      if (oldest !== undefined) this.kept.delete(oldest);
    }
    return { scanId: scan.id, document: read.document };
  }
}
