import type { ApiClient, PaginationQuery } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class TeamQueries {
  private constructor() {}

  public static list(client: ApiClient, params: PaginationQuery) {
    return queryOptions({
      queryKey: QueryKeys.team.list(params),
      queryFn: () => client.team.list(params),
      staleTime: 60_000,
    });
  }

  public static members(client: ApiClient, teamId: string) {
    return queryOptions({
      queryKey: QueryKeys.team.members(teamId),
      queryFn: () => client.team.members({ teamId: teamId }),
      staleTime: 30_000,
    });
  }
}
