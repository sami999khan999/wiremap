import type { AccountClient } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

// A defined query, never a raw client call from a component: a raw call is an uncached
// read that no invalidation touches.
export class AccountQueries {
  private constructor() {}

  // The ways this account can be signed into. Read on the security page and after every
  // link or unlink, which is why the mutations invalidate this key rather than setting it.
  public static linkedAccounts(account: AccountClient) {
    return queryOptions({
      queryKey: QueryKeys.account.accounts(),
      queryFn: () => account.listAccounts(),
      // Changed only by a mutation on this same page, each of which invalidates. The
      // stale time is a backstop against a second tab, not the refresh mechanism.
      staleTime: 60_000,
    });
  }

  // Shorter-lived than the list above: a session can end without this tab doing anything,
  // and a minute-old answer here lies about the thing the screen exists for.
  public static sessions(account: AccountClient) {
    return queryOptions({
      queryKey: QueryKeys.account.sessions(),
      queryFn: () => account.listSessions(),
      staleTime: 10_000,
    });
  }
}
