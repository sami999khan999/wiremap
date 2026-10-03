import type { ApiClient, GraphDocument, PaginationQuery, ProjectId, ScanId } from "../import.js";
import { GRAPH_VERSION, queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class ScanQueries {
  private constructor() {}

  // Polled every three seconds while a scan is queued or running, and only then: nothing
  // pushes, so the page asks. `refetchIntervalInBackground` stays off.
  public static list(client: ApiClient, projectId: ProjectId, params: PaginationQuery) {
    return queryOptions({
      queryKey: QueryKeys.scan.list(projectId, params),
      queryFn: () => client.scan.list({ projectId, ...params }),
      staleTime: 10_000,
      refetchInterval: (query) =>
        query.state.data?.items.some((scan) => scan.state === "queued" || scan.state === "running")
          ? 3_000
          : false,
    });
  }

  // The signed URL lives five minutes; refetched well before it lapses.
  public static graph(client: ApiClient, projectId: ProjectId, scanId: ScanId | null) {
    return queryOptions({
      queryKey: QueryKeys.scan.graph(projectId, scanId),
      queryFn: () => client.scan.graph({ projectId, scanId }),
      staleTime: 3 * 60_000,
      retry: false,
    });
  }

  // The gzipped graph from its signed URL, kept for good: a scan's graph never changes. A
  // version this build cannot read is an error the page names, not a crash.
  public static document(link: { readonly scanId: ScanId; readonly url: string }) {
    return queryOptions({
      queryKey: QueryKeys.scan.document(link.scanId),
      queryFn: async (): Promise<GraphDocument> => {
        const response = await fetch(link.url);
        if (!response.ok || !response.body) throw new Error(`graph ${response.status}`);
        const text = await new Response(
          response.body.pipeThrough(new DecompressionStream("gzip")),
        ).text();
        const document = JSON.parse(text) as GraphDocument;
        if (document.version !== GRAPH_VERSION) throw new Error("graph-version");
        return document;
      },
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 60_000,
      retry: 1,
    });
  }
}
