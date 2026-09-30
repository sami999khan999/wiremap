import type { ApiClient } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class OverrideQueries {
  private constructor() {}

  // Ten seconds: a grant written in another tab changes what this person may do, and the
  // panel is where an admin checks that it did.
  public static list(client: ApiClient, userId: string) {
    return queryOptions({
      queryKey: QueryKeys.override.list(userId),
      queryFn: () => client.override.list({ userId }),
      enabled: userId !== "",
      staleTime: 10_000,
    });
  }
}
