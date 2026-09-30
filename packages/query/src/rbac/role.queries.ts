import type { ApiClient, PaginationQuery } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

// A defined query, never a raw client call from a component — the rule the ESLint ban on
// importing `api-client` elsewhere enforces.
export class RoleQueries {
  private constructor() {}

  public static list(client: ApiClient, params: PaginationQuery) {
    return queryOptions({
      // Mirrors the procedure path, so `QueryKeys.rbac.all()` invalidates this by prefix
      // along with everything else the slice caches.
      queryKey: QueryKeys.rbac.roles(params),
      queryFn: () => client.role.list(params),
      // A minute is a backstop against a second tab, not the mechanism: every edit goes
      // through a mutation that invalidates this key.
      staleTime: 60_000,
    });
  }

  // The org's ceiling. Five minutes: it moves when a platform admin changes the plan,
  // which is rare, and a stale answer only greys a box the server refuses anyway.
  public static entitlement(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.rbac.entitlement(),
      queryFn: () => client.role.entitlement(),
      staleTime: 300_000,
    });
  }

  // Someone else's effective permissions. `staleTime: 0` on purpose: an inspector is
  // read to answer "why can they do that", and a cached answer is the wrong one.
  public static effective(client: ApiClient, userId: string) {
    return queryOptions({
      queryKey: QueryKeys.rbac.effective(userId),
      queryFn: () => client.role.effective({ userId }),
      staleTime: 0,
    });
  }
}
