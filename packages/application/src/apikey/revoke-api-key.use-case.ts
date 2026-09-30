import { type ApiKeyId, type Clock, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ApiKeyRepository, ApiKeySummary } from "./api-key.repository.js";

export interface RevokeApiKeyInput {
  readonly apiKeyId: ApiKeyId;
}

// Revocation is a timestamp, not a delete: a key that authenticated something last week
// is part of the audit trail, and a deleted row answers no question about it.
export class RevokeApiKeyUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly keys: ApiKeyRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: RevokeApiKeyInput): Promise<ApiKeySummary> {
    this.authorizer.assert(actor, "apikey.manage");

    const key = await this.keys.findById(actor.organizationId, input.apiKeyId);
    if (!key) throw new NotFoundError("apiKey", input.apiKeyId);

    // Idempotent, and it keeps the original timestamp: re-revoking must not rewrite when
    // the credential actually stopped working.
    if (key.revokedAt) return key;

    const at = this.clock.now();

    await this.unitOfWork.run(async () => {
      await this.keys.revoke(actor.organizationId, key.id, at);
      await this.activity.record(actor, "apikey.revoked", {
        apiKeyId: key.id,
        prefix: key.prefix,
      });
    });

    return { ...key, revokedAt: at };
  }
}
