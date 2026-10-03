import type { ActivityListQuery, ApiClient, ProjectId } from "../import.js";
import { infiniteQueryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

type Filters = Omit<ActivityListQuery, "cursor" | "limit">;

export class ActivityQueries {
  private constructor() {}

  // Keyset-paged, so infinite: "Load older" follows `nextCursor` and never re-reads a row.
  public static list(client: ApiClient, filters: Filters, limit = 50) {
    return infiniteQueryOptions({
      queryKey: QueryKeys.activity.list(filters),
      queryFn: ({ pageParam }) =>
        client.activity.list({ ...filters, limit, ...(pageParam ? { cursor: pageParam } : {}) }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => page.nextCursor,
      staleTime: 15_000,
    });
  }

  public static project(client: ApiClient, projectId: ProjectId, limit = 50) {
    return infiniteQueryOptions({
      queryKey: QueryKeys.projectActivity.list(projectId),
      queryFn: ({ pageParam }) =>
        client.activity.project({ projectId, limit, ...(pageParam ? { cursor: pageParam } : {}) }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => page.nextCursor,
      staleTime: 15_000,
    });
  }
}
