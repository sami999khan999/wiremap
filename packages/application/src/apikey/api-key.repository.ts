import type { ApiKeyId, OrganizationId, PaginationQuery, UserId } from "../import.js";

// What authentication needs, and the only shape carrying the digest.
export interface ApiKeyRecord {
  readonly id: ApiKeyId;
  readonly organizationId: OrganizationId;
  readonly issuerId: UserId;
  readonly tokenHash: string;
  // Raw strings from the database. Filtered through the registry before they are trusted.
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

// What a settings page needs. Deliberately a second type rather than a subset of the
// first: a hash that cannot be in the shape cannot be mapped onto the wire by accident.
export interface ApiKeySummary {
  readonly id: ApiKeyId;
  readonly name: string;
  // The indexed lookup column, and the only part of a token that survives creation —
  // which makes it the handle a person uses to recognise a key in a list.
  readonly prefix: string;
  readonly issuerId: UserId;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

export interface ApiKeyPage {
  readonly items: readonly ApiKeySummary[];
  readonly total: number;
}

export interface NewApiKey {
  readonly id: ApiKeyId;
  readonly name: string;
  readonly issuerId: UserId;
  readonly prefix: string;
  readonly tokenHash: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
}

// Here rather than in `auth`, which is where it used to live: a key stopped being purely
// an authentication artifact the moment the product grew a screen for issuing one.
export abstract class ApiKeyRepository {
  // Not tenant-scoped, and it cannot be: the organization is what this lookup
  // *establishes*, from a bare header with no principal behind it yet.
  public abstract findByPrefix(prefix: string): Promise<readonly ApiKeyRecord[]>;

  // `notBefore` is the throttle: a write on every authenticated request is one write per
  // request forever, and "roughly when it was last used" is what the column is read for.
  public abstract touch(id: ApiKeyId, at: Date, notBefore: Date): Promise<void>;

  public abstract listByOrganization(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<ApiKeyPage>;

  public abstract findById(
    organizationId: OrganizationId,
    apiKeyId: ApiKeyId,
  ): Promise<ApiKeySummary | null>;

  // `create`, not `save`: a key is written once and never edited, so an upsert would be
  // a shape nothing needs and a way to overwrite a live credential.
  public abstract create(organizationId: OrganizationId, key: NewApiKey): Promise<void>;

  public abstract revoke(
    organizationId: OrganizationId,
    apiKeyId: ApiKeyId,
    at: Date,
  ): Promise<void>;
}
