import type { ApiClient } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class OrganizationQueries {
  private constructor() {}

  public static get(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.organization.get(),
      queryFn: () => client.organization.get({}),
      staleTime: 60_000,
    });
  }
}
