import type { AuthInstance } from "../factory/index.js";
import {
  type OrganizationId,
  type RequestHeaders,
  type ResolvedSession,
  SessionResolver,
  type UserId,
} from "../import.js";

// The only place that names Better Auth's session API; everything else depends on
// `SessionResolver`. Replacing the library rewrites this file and nothing else.
export class BetterAuthSessionResolver extends SessionResolver {
  public constructor(private readonly auth: AuthInstance) {
    super();
  }

  // `getSession` handles cookie and bearer transparently; both arrive as headers.
  public override async resolve(headers: RequestHeaders): Promise<ResolvedSession | null> {
    // Better Auth reads cookies by iterating, so the narrow `RequestHeaders` port is not
    // enough: a stub with only `get` typechecks here and fails at runtime.
    const result = await this.auth.api.getSession({ headers: headers as Headers });
    if (!result?.session) return null;

    // Pinned by the session-create hook, so a session predating it has none. No session
    // at all rather than a default: guessing a tenant is a silent cross-tenant read.
    const { activeOrganizationId } = result.session as { activeOrganizationId?: string };
    if (!activeOrganizationId) return null;

    return {
      organizationId: activeOrganizationId as OrganizationId,
      userId: result.session.userId as UserId,
      sessionId: result.session.id,
      expiresAt: new Date(result.session.expiresAt),
    };
  }
}
