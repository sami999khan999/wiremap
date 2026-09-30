import {
  type ApiKeyRepository,
  ApiKeyRules,
  CapabilitySet,
  type PermissionKey,
  PermissionRegistry,
  Principal,
} from "../import.js";
import type { CapabilityCache } from "../principal/capability.cache.js";
import type { MembershipReader } from "../session/membership.reader.js";
import { ApiKeyHasher } from "./api-key.hasher.js";

export class ApiKeyResolver {
  public constructor(
    private readonly repository: ApiKeyRepository,
    private readonly capabilities: CapabilityCache,
    private readonly memberships: MembershipReader,
  ) {}

  public async resolve(token: string): Promise<Principal | null> {
    const hash = await ApiKeyHasher.hash(token);
    const candidates = await this.repository.findByPrefix(ApiKeyHasher.prefixOf(token));

    const record = candidates.find((candidate) =>
      ApiKeyHasher.timingSafeEqual(candidate.tokenHash, hash),
    );
    if (!record) return null;

    const now = new Date();
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt <= now) return null;

    const registry = PermissionRegistry.instance;
    const scoped = record.scopes.filter((scope): scope is PermissionKey => registry.isKnown(scope));

    const declared = CapabilitySet.from({
      wildcard: false,
      org: { grants: scoped, denies: [] },
      goals: {},
    });

    // Re-intersected per request, never frozen at creation: revoking a person has to
    // narrow every key they issued. See docs/reference/api-key.md.
    const [active, issuer] = await Promise.all([
      this.memberships.isActive(record.issuerId, record.organizationId),
      this.capabilities.forUser(record.organizationId, record.issuerId),
    ]);
    // The session path's check, and for the same reason: a deactivated issuer is no
    // principal at all, and `core` keys survive any intersection.
    if (!active) return null;
    const effective = declared.intersect(issuer);

    // Throttled, not skipped: unthrottled this is one write per authenticated request
    // forever, and the column is only ever read as "roughly when".
    await this.repository.touch(
      record.id,
      now,
      new Date(now.getTime() - ApiKeyRules.TOUCH_THROTTLE_MS),
    );
    return Principal.apiKey(record.organizationId, record.issuerId, effective);
  }
}
