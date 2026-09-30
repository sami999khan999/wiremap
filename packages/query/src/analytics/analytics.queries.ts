import type { ApiClient } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class AnalyticsQueries {
  private constructor() {}

  // A minute: the store trails the audit trail by half a minute and projects every
  // five, so refetching faster than this shows the same numbers again.
  public static activity(client: ApiClient, days: 30 | 90) {
    return queryOptions({
      queryKey: QueryKeys.analytics.activity(days),
      queryFn: () => client.analytics.activity({ days }),
      staleTime: 60_000,
    });
  }
}
