import type { ApiClient, PaginationQuery } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

// Defined queries, never a raw client call from a component: a raw call is an uncached
// read that no invalidation touches.
export class MemberQueries {
  private constructor() {}

  public static list(client: ApiClient, params: PaginationQuery) {
    return queryOptions({
      queryKey: QueryKeys.member.list(params),
      queryFn: () => client.member.list(params),
      // Changes when someone joins or is deactivated, and every path to that
      // invalidates `member.all()`. A minute is a backstop against a second tab.
      staleTime: 60_000,
    });
  }

  // Shorter-lived than the member list: an invitation can be accepted from another device
  // at any moment, and a claimed row on screen lies about what it shows.
  public static invitations(client: ApiClient, params: PaginationQuery) {
    return queryOptions({
      queryKey: QueryKeys.member.invitations(params),
      queryFn: () => client.member.listInvitations(params),
      staleTime: 10_000,
    });
  }
}
