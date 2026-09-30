import type { ApiClient, OrganizationId } from "../import.js";
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

  // `staleTime: 0`: every URL in the answer is presigned and expires, so a cached
  // page is a page of links that have quietly stopped working.
  public static exports(client: ApiClient, organizationId: OrganizationId) {
    return queryOptions({
      queryKey: QueryKeys.platform.exports(organizationId),
      queryFn: () => client.platform.listExports({ organizationId }),
      staleTime: 0,
    });
  }

  // Ten seconds, like the status read: a switch somebody may have just thrown from another
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
}
