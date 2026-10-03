import type { ApiClient } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class GithubQueries {
  private constructor() {}

  public static status(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.github.status(),
      queryFn: () => client.github.status({}),
      staleTime: 30_000,
    });
  }
}
