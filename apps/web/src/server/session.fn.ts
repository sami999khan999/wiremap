import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Env } from "~/env.js";
import { CapabilitySet, FlagRegistry, type OrganizationId, type UserId } from "~/import.js";
import type { SessionSnapshot } from "~/store/session.store.js";
import { container } from "./container.js";

// Not a module constant any more: `googleEnabled` is read from the environment, and
// freezing it at module load would be correct but would hide where it comes from.
const anonymous = (): SessionSnapshot => ({
  user: null,
  capabilities: CapabilitySet.empty().toJSON(),
  isPlatformOrganization: false,
  googleEnabled: Env.googleEnabled,
  flags: [],
});

// Resolves who is asking and what they may do, and decides nothing. Not routed through
// `PrincipalBuilder` — see docs/reference/server-functions.md.
export const fetchSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionSnapshot> => {
    const request = getRequest();
    const result = await container.auth.api.getSession({ headers: request.headers });

    if (!result?.session) return anonymous();

    // A session without a tenant is treated as no session, agreeing with
    // `BetterAuthSessionResolver`: rendering a user the server would refuse is worse.
    const { activeOrganizationId } = result.session as { activeOrganizationId?: string };
    if (!activeOrganizationId) return anonymous();

    const userId = result.session.userId as UserId;

    // The same cache and the same merge `PrincipalBuilder` runs, so client `can()` and
    // server `assert()` answer off one set. The membership list rides along too.
    const [tenant, platform, organizations, platformOrganizationId, isActive, flags] =
      await Promise.all([
        container.capabilities.forUser(activeOrganizationId as OrganizationId, userId),
        container.capabilities.platformFor(userId),
        container.memberships.organizationsFor(userId),
        container.platform.organizationId(),
        container.memberships.isActive(userId, activeOrganizationId as OrganizationId),
        container.flags.onFor(activeOrganizationId as OrganizationId),
      ]);

    // `PrincipalBuilder` returns null for a deactivated membership, so without this the
    // shell rendered and every stream it opened answered UNAUTHORIZED and reconnected.
    if (!isActive) return anonymous();

    const capabilities = CapabilitySet.from({
      ...tenant.toJSON(),
      platform: platform.toJSON().platform,
    });

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        activeOrganizationId,
        organizations: organizations.map((entry) => ({
          id: entry.id,
          name: entry.name,
          roleName: entry.roleName,
          // Only ever on the user's own memberships, so no one learns the tier's id this way.
          isPlatform: entry.id === platformOrganizationId,
        })),
        // Better Auth's own column, widened onto the user by the two-factor plugin.
        twoFactorEnabled: (result.user as { twoFactorEnabled?: boolean }).twoFactorEnabled === true,
      },
      capabilities: capabilities.toJSON(),
      isPlatformOrganization: activeOrganizationId === platformOrganizationId,
      googleEnabled: Env.googleEnabled,
      // Filtered here, on the server: the browser is never sent a flag it could not use.
      flags: flags.filter((key) => FlagRegistry.instance.isClientGating(key)),
    };
  },
);
