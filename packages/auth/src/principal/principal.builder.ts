import type { ApiKeyResolver } from "../apikey/api-key.resolver.js";
import {
  CapabilitySet,
  type OrganizationId,
  Principal,
  type RequestHeaders,
  type SessionResolver,
  type UserId,
} from "../import.js";
import type { MembershipReader } from "../session/membership.reader.js";
import type { CapabilityCache } from "./capability.cache.js";

// Four credential types collapse into one `Principal` here, so a single
// `Authorizer.assert()` serves every surface.
export class PrincipalBuilder {
  public constructor(
    private readonly sessions: SessionResolver,
    private readonly apiKeys: ApiKeyResolver,
    private readonly capabilities: CapabilityCache,
    private readonly memberships: MembershipReader,
  ) {}

  public async fromHeaders(headers: RequestHeaders): Promise<Principal | null> {
    // First, deliberately: checking the session first would silently upgrade a scoped key
    // to the issuer's full permissions. See docs/reference/principal-builder.md.
    const apiKey = headers.get("x-api-key");
    if (apiKey) return this.apiKeys.resolve(apiKey);

    const session = await this.sessions.resolve(headers);
    if (!session) return null;

    return this.forUser(session.organizationId, session.userId);
  }

  // What a held stream asks each minute: the principal it opened with, as it stands now.
  // `null` once deactivated. A key only narrows — its declared scopes are not in hand here.
  public async refresh(principal: Principal): Promise<Principal | null> {
    const { organizationId, userId } = principal;

    if (principal.kind === "user") return this.forUser(organizationId, userId);
    if (principal.kind === "system") return principal;

    const [active, issuer] = await Promise.all([
      this.memberships.isActive(userId, organizationId),
      this.capabilities.forUser(organizationId, userId),
    ]);
    if (!active) return null;
    return Principal.apiKey(organizationId, userId, principal.capabilities.intersect(issuer));
  }

  private async forUser(organizationId: OrganizationId, userId: UserId): Promise<Principal | null> {
    // Before the capabilities, because a deactivated membership is not a principal with
    // nothing granted — it is no principal at all. One row on `memberships_uq`.
    if (!(await this.memberships.isActive(userId, organizationId))) return null;

    // In parallel: two independent reads, both usually cache hits, and serialising them
    // puts a second round trip on every request that misses.
    const [tenant, platform] = await Promise.all([
      this.capabilities.forUser(organizationId, userId),
      this.capabilities.platformFor(userId),
    ]);

    // Merged rather than chosen between: a platform admin switched into a customer tenant
    // is still a platform admin, and is still only a member of that tenant.
    const capabilities = CapabilitySet.from({
      ...tenant.toJSON(),
      platform: platform.toJSON().platform,
    });

    return new Principal(organizationId, userId, capabilities, "user");
  }
}
