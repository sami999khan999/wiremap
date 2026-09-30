import type { ApiClient, OrganizationId, ShardMapQuery, TenantStorageQuery } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class PlatformQueries {
  private constructor() {}

  // Ten seconds, not a minute: this is a health report, and the reason to open the page
  // is that something may be wrong right now.
  public static status(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.status(),
      queryFn: () => client.platform.status(),
      staleTime: 10_000,
    });
  }

  // `staleTime: 0`, and `enabled` is the caller's: this answers "what would this
  // number destroy", and a cached answer is the wrong one.
  public static retentionPreview(
    client: ApiClient,
    tableName: string,
    hotMonths: number,
    organizationId?: string,
  ) {
    return queryOptions({
      queryKey: QueryKeys.platform.retentionPreview(tableName, hotMonths, organizationId),
      queryFn: () =>
        client.platform.previewRetention({
          tableName,
          hotMonths,
          ...(organizationId ? { organizationId } : {}),
        }),
      staleTime: 0,
    });
  }

  // A minute: what this shows changes when the nightly run archives a month, so a
  // fresh read on every focus would be a query for a number that moved once.
  public static storage(client: ApiClient, params: TenantStorageQuery) {
    return queryOptions({
      queryKey: QueryKeys.platform.storage(params),
      queryFn: () => client.platform.listStorage(params),
      staleTime: 60_000,
    });
  }

  // `staleTime: 0`: every URL in the answer is presigned and expires, so a cached
  // page is a page of links that have quietly stopped working.
  public static exports(client: ApiClient, organizationId: OrganizationId) {
    return queryOptions({
      queryKey: QueryKeys.platform.exports(organizationId),
      queryFn: () => client.platform.listExports({ organizationId }),
      staleTime: 0,
    });
  }

  // A minute: the directory changes when a tenant is founded or moved, and neither is
  // something an operator sits on this screen waiting for.
  public static shardMap(client: ApiClient, params: ShardMapQuery) {
    return queryOptions({
      queryKey: QueryKeys.platform.shardMap(params),
      queryFn: () => client.platform.shardMap(params),
      staleTime: 60_000,
    });
  }

  // `staleTime: 0`, and `enabled` is the caller's: this answers "which node holds this
  // one", and a cached answer after a move names the node it left.
  public static tenantLocation(client: ApiClient, term: string) {
    return queryOptions({
      queryKey: QueryKeys.platform.tenantLocation(term),
      queryFn: () => client.platform.locateTenant({ term }),
      staleTime: 0,
    });
  }

  // `staleTime: 0`: the list is what a re-project acts on, and acting on a stale one
  // is queueing a job for a month that was filled a minute ago.
  public static gaps(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.gaps(),
      queryFn: () => client.platform.listGaps(),
      staleTime: 0,
    });
  }

  // Ten seconds, like the status read: this is a switch somebody may have just thrown
  // from another tab, and a stale answer is a button that does the opposite.
  public static policy(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.policy(),
      queryFn: () => client.platform.getPolicy(),
      staleTime: 10_000,
    });
  }

  // Ten seconds, like the policy read: a switch somebody may have just thrown from another
  // tab, and a stale answer is a toggle that does the opposite.
  public static flags(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.flags(),
      queryFn: () => client.platform.listFlags(),
      staleTime: 10_000,
    });
  }

  // A minute: plans change when somebody saves, and every save invalidates this key.
  public static plans(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.plans(),
      queryFn: () => client.platform.listPlans(),
      staleTime: 60_000,
    });
  }

  // Keyed on the term the operator typed, so two lookups are two answers. Disabled
  // until there is one: an empty term is a request for nobody.
  public static entitlement(client: ApiClient, organization: string) {
    return queryOptions({
      queryKey: QueryKeys.platform.entitlement(organization),
      queryFn: () => client.platform.organizationEntitlement({ organization }),
      enabled: organization.trim() !== "",
      staleTime: 10_000,
    });
  }

  // By the address the operator typed, and disabled until there is one. Five seconds:
  // this is the screen someone is on while an account is being locked.
  public static account(client: ApiClient, email: string) {
    return queryOptions({
      queryKey: QueryKeys.platform.account(email),
      queryFn: () => client.platform.findAccount({ email }),
      enabled: email.trim() !== "",
      staleTime: 5_000,
    });
  }

  // Ten seconds, like the status read it sits beside: during an incident this is the
  // switch someone may have just thrown from another tab.
  public static moduleSwitches(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.modules(),
      queryFn: () => client.platform.moduleSwitches(),
      staleTime: 10_000,
    });
  }

  // A minute, like the retention read beside it: the rows change when somebody saves,
  // and the mutation invalidates this key. The backstop is for a second tab.
  public static projection(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.projection(),
      queryFn: () => client.platform.listProjection(),
      staleTime: 60_000,
    });
  }

  // A minute, like every other settings read: the rows change when somebody saves, and
  // the mutation invalidates this key. The backstop is for a second tab.
  public static retention(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.platform.retention(),
      queryFn: () => client.platform.listRetention(),
      staleTime: 60_000,
    });
  }
}
