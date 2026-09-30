import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ApiKeyRepository, ApiKeySummary } from "./api-key.repository.js";

export interface ListApiKeysResult {
  readonly items: readonly ApiKeySummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export class ListApiKeysUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly keys: ApiKeyRepository,
  ) {}

  public async execute(actor: Principal, input: PaginationQuery): Promise<ListApiKeysResult> {
    this.authorizer.assert(actor, "apikey.read");

    // The tenant comes off the principal, never the input: no argument a caller passes
    // can widen this read to another organization's keys.
    const page = await this.keys.listByOrganization(actor.organizationId, input);

    return { ...page, limit: input.limit, offset: input.offset };
  }
}
