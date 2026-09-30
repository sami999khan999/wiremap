import type { OrganizationId } from "../import.js";
import type { StorageGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";

export interface TenantExportObject {
  readonly key: string;
  // `YYYY-MM-DD`, off the key. The bucket is the index here: nothing records an export
  // in Postgres, and a table that could disagree with the bucket would be worse.
  readonly day: string;
  readonly url: string;
}

export interface ListTenantExportsInput {
  readonly organizationId: OrganizationId;
}

// Fifteen minutes. Long enough to click every link on the page, short enough that a
// URL pasted into a ticket stops working before anyone finds it.
const EXPIRES_IN = 900;

export class ListTenantExportsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly storage: StorageGateway,
  ) {}

  public async execute(
    actor: Principal,
    input: ListTenantExportsInput,
  ): Promise<readonly TenantExportObject[]> {
    this.authorizer.assert(actor, "platform.tenant.manage");

    const keys = await this.storage.list(`export/${input.organizationId}/`);

    return Promise.all(
      keys.map(async (key) => ({
        key,
        day: key.split("/")[2] ?? "",
        url: await this.storage.presignDownload(key, EXPIRES_IN),
      })),
    );
  }
}
