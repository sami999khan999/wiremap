import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

export class ApiKeyContract {
  private constructor() {}

  // No `token` and no hash. The plaintext exists in exactly one response shape, and it
  // is not this one — a list that could carry a credential eventually does.
  public static readonly entity = z.object({
    id: Identifiers.apiKeyId,
    name: z.string().min(1),
    // The first eight characters of the token, which is all that survives creation and
    // therefore the only handle a person has for recognising a key in a list.
    prefix: z.string().min(1),
    issuerId: Identifiers.userId,
    // Raw strings, filtered by `PermissionRegistry.isKnown()` at the point of use rather
    // than here: a renamed permission must not make this endpoint throw.
    scopes: z.array(z.string()).readonly(),
    expiresAt: z.date().nullable(),
    revokedAt: z.date().nullable(),
    lastUsedAt: z.date().nullable(),
    createdAt: z.date(),
  });

  public static readonly create = z.object({
    name: z.string().min(1).max(120),
    // Capped, because the request body is the only bound on this: an unbounded array is
    // a way to make one insert arbitrarily large.
    scopes: z.array(z.string().min(1).max(120)).min(1).max(64).readonly(),
    expiresAt: z.date().nullable().default(null),
  });

  // The one response carrying the plaintext, and it is returned exactly once — which is
  // why it is a distinct shape rather than an optional field on the entity.
  public static readonly created = z.object({
    key: ApiKeyContract.entity,
    token: z.string().min(1),
  });

  public static readonly revoke = z.object({ apiKeyId: Identifiers.apiKeyId });

  public static readonly listQuery = Pagination.query;
}

export type ApiKeyDto = z.infer<typeof ApiKeyContract.entity>;
export type CreateApiKeyInput = z.infer<typeof ApiKeyContract.create>;
export type CreatedApiKeyDto = z.infer<typeof ApiKeyContract.created>;
export type RevokeApiKeyInput = z.infer<typeof ApiKeyContract.revoke>;
