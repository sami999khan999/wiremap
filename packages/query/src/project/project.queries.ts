import type { ApiClient, PaginationQuery, ProjectId } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class ProjectQueries {
  private constructor() {}

  public static list(client: ApiClient, params: PaginationQuery) {
    return queryOptions({
      queryKey: QueryKeys.project.list(params),
      queryFn: () => client.project.list(params),
      staleTime: 60_000,
    });
  }

  public static detail(client: ApiClient, slug: string) {
    return queryOptions({
      queryKey: QueryKeys.project.detail(slug),
      queryFn: () => client.project.get({ slug }),
      staleTime: 60_000,
    });
  }

  // Read live from GitHub on every open of the picker, so a short life is the honest one.
  public static available(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.project.available(),
      queryFn: () => client.project.available({}),
      staleTime: 15_000,
    });
  }

  public static access(client: ApiClient, projectId: ProjectId) {
    return queryOptions({
      queryKey: QueryKeys.project.access(projectId),
      queryFn: () => client.project.access({ projectId }),
      staleTime: 30_000,
    });
  }
}
