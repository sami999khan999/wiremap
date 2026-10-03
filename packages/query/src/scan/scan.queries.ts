import type { ApiClient, PaginationQuery, ProjectId, ScanId } from "../import.js";
import { queryOptions } from "../import.js";
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
}
