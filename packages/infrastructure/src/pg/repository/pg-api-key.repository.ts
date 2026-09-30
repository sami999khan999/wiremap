import {
  type ApiKeyId,
  type ApiKeyPage,
  type ApiKeyRecord,
  type ApiKeyRepository,
  type ApiKeySummary,
  and,
  asc,
  count,
  eq,
  isNull,
  lt,
  type NewApiKey,
  type OrganizationId,
  or,
  type PaginationQuery,
  type Placement,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { apiKeys } from "../schema/index.js";

// The columns a settings page renders. `token_hash` is absent on purpose: the read that
// lists keys must not be able to hand one to a caller.
const SUMMARY = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  issuerId: apiKeys.issuerId,
  scopes: apiKeys.scopes,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  lastUsedAt: apiKeys.lastUsedAt,
  createdAt: apiKeys.createdAt,
};

export class PgApiKeyRepository extends BaseRepository implements ApiKeyRepository {
  // `api_keys` is one of the two lookups that arrive holding no tenant.
  protected override readonly placement: Placement = "catalog";

  // Not tenant-scoped, and it cannot be: the organization is what this lookup
  // *establishes*, from a bare header with no principal behind it yet.
  public async findByPrefix(prefix: string): Promise<readonly ApiKeyRecord[]> {
    const rows = await this.db
      .select({
        id: apiKeys.id,
        organizationId: apiKeys.organizationId,
        issuerId: apiKeys.issuerId,
        tokenHash: apiKeys.tokenHash,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.prefix, prefix));

    return rows.map((row) => ({
      ...row,
      id: row.id as ApiKeyId,
      organizationId: row.organizationId as OrganizationId,
    }));
  }

  // A write on the read path, so the predicate carries the throttle: an unthrottled
  // version is one UPDATE per authenticated request, forever.
  public async touch(id: ApiKeyId, at: Date, notBefore: Date): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: at })
      .where(
        and(eq(apiKeys.id, id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, notBefore))),
      );
  }

  public async listByOrganization(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<ApiKeyPage> {
    const rows = await this.db
      .select(SUMMARY)
      .from(apiKeys)
      // Every read narrows by tenant. There is no code path here that could omit it.
      .where(eq(apiKeys.organizationId, organizationId))
      // By creation, so a page boundary is stable: ordering by last use reshuffles the
      // list under the reader every time a key authenticates.
      .orderBy(asc(apiKeys.createdAt))
      .limit(page.limit)
      .offset(page.offset);

    const [counted] = await this.db
      .select({ total: count() })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, organizationId));

    return {
      items: rows.map((row) => PgApiKeyRepository.toSummary(row)),
      total: counted?.total ?? 0,
    };
  }

  public async findById(
    organizationId: OrganizationId,
    apiKeyId: ApiKeyId,
  ): Promise<ApiKeySummary | null> {
    const [row] = await this.db
      .select(SUMMARY)
      .from(apiKeys)
      .where(and(eq(apiKeys.organizationId, organizationId), eq(apiKeys.id, apiKeyId)))
      .limit(1);

    return row ? PgApiKeyRepository.toSummary(row) : null;
  }

  public async create(organizationId: OrganizationId, key: NewApiKey): Promise<void> {
    await this.db.insert(apiKeys).values({
      id: key.id,
      organizationId,
      name: key.name,
      issuerId: key.issuerId,
      prefix: key.prefix,
      tokenHash: key.tokenHash,
      scopes: [...key.scopes],
      expiresAt: key.expiresAt,
    });
  }

  // Only the first revocation writes: `revoked_at is null` in the predicate keeps the
  // moment the credential actually stopped working, whatever a retry asks for.
  public async revoke(organizationId: OrganizationId, apiKeyId: ApiKeyId, at: Date): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ revokedAt: at })
      .where(
        and(
          eq(apiKeys.organizationId, organizationId),
          eq(apiKeys.id, apiKeyId),
          isNull(apiKeys.revokedAt),
        ),
      );
  }

  private static toSummary(row: {
    id: string;
    name: string;
    prefix: string;
    issuerId: UserId;
    scopes: string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }): ApiKeySummary {
    return { ...row, id: row.id as ApiKeyId };
  }
}
