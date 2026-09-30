import type { OrganizationId, PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type {
  TenantStorageMonth,
  TenantStorageReader,
  TenantStorageRow,
} from "./tenant-storage.reader.js";

export interface ListTenantStorageInput extends PaginationQuery {
  // Present narrows the page to one tenant **and** fills `months`. Absent is the
  // league table, which is the question this screen usually answers.
  readonly organizationId?: OrganizationId;
}

export interface TenantStorageList {
  readonly items: readonly TenantStorageRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  // Empty unless one tenant was named: months × retired tables is bounded, but it is
  // not bounded across every tenant at once.
  readonly months: readonly TenantStorageMonth[];
}

// Cold storage only: a partition holds one tenant's rows, but Postgres reports size
// per table, so hot bytes have no tenant to belong to.
export class ListTenantStorageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly storage: TenantStorageReader,
  ) {}

  public async execute(
    actor: Principal,
    input: ListTenantStorageInput,
  ): Promise<TenantStorageList> {
    this.authorizer.assert(actor, "platform.storage.read");

    const organizationId = input.organizationId ?? null;
    const page = await this.storage.byTenant(input, organizationId);
    const months = organizationId ? await this.storage.monthsFor(organizationId) : [];

    return { ...page, limit: input.limit, offset: input.offset, months };
  }
}
