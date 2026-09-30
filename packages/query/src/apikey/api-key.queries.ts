import type { ApiClient, PaginationQuery } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class ApiKeyQueries {
  private constructor() {}

  public static list(client: ApiClient, params: PaginationQuery) {
    return queryOptions({
      queryKey: QueryKeys.apiKey.list(params),
      queryFn: () => client.apiKey.list(params),
      // Shorter than the roles list: `lastUsedAt` moves on its own, and this page is
      // read to answer "is this key still in use".
      staleTime: 15_000,
    });
  }
}
