import { type ApiKeyId, type Clock, ForbiddenError, Uuid, ValidationError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ApiKeyRepository, ApiKeySummary } from "./api-key.repository.js";
import { ApiKeyRules } from "./api-key.rules.js";

export interface CreateApiKeyInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
}

export interface CreatedApiKey {
  readonly key: ApiKeySummary;
  // The one time this value exists outside the caller's process. It is not stored, and
  // a second read of the same key cannot produce it.
  readonly token: string;
}

export class CreateApiKeyUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly keys: ApiKeyRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    this.authorizer.assert(actor, "apikey.manage");
    // A key minting a key outlives its own revocation: the child is the issuer's, not the
    // parent's, and nothing ties the two. Keys are made by a person, signed in.
    if (actor.kind === "api_key") throw new ForbiddenError("apikey.manage");

    const scopes = ApiKeyRules.assertKnownScopes(input.scopes);

    // `ApiKeyResolver` intersects a key with its issuer's live capabilities on every
    // request, so a scope the actor lacks would grant nothing — until they are promoted.
    const excess = scopes.find((scope) => !actor.can(scope));
    if (excess) throw new ForbiddenError(excess);

    const now = this.clock.now();
    if (input.expiresAt && input.expiresAt <= now) {
      throw new ValidationError([{ field: "expiresAt", rule: "past" }]);
    }

    const minted = await ApiKeyRules.mint();
    const id = Uuid.v7() as ApiKeyId;

    const key: ApiKeySummary = {
      id,
      name: input.name,
      prefix: minted.prefix,
      issuerId: actor.userId,
      scopes,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };

    await this.unitOfWork.run(async () => {
      await this.keys.create(actor.organizationId, {
        id,
        name: input.name,
        issuerId: actor.userId,
        prefix: minted.prefix,
        tokenHash: minted.tokenHash,
        scopes,
        expiresAt: input.expiresAt,
      });
      // The prefix and the scopes, never the token: an audit trail that recorded the
      // credential would undo the reason it is only ever hashed.
      await this.activity.record(actor, "apikey.created", {
        apiKeyId: id,
        prefix: minted.prefix,
        scopes,
      });
    });

    return { key, token: minted.token };
  }
}
