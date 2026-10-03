import {
  APIError,
  type BetterAuthPlugin,
  createAuthEndpoint,
  type GenericEndpointContext,
  type OrganizationId,
  sessionMiddleware,
  setSessionCookie,
  type User,
  type UserId,
  z,
} from "../import.js";
import type { InvitationClaimer } from "../session/invitation.claimer.js";
import type { InvitationLinkClaimer } from "../session/invitation-link.claimer.js";
import type { MembershipReader } from "../session/membership.reader.js";
import type { OrganizationFounder } from "../session/organization.founder.js";

// Long enough for any real name, short enough that a pasted paragraph is refused.
const NAME_MAX = 80;

const switchBody = z.object({ organizationId: z.uuid() });
const createBody = z.object({ name: z.string().trim().min(1).max(NAME_MAX) });
const acceptBody = z.object({ token: z.string().min(1) });

// The three actions that end in a session pointing at a different tenant. Endpoints
// rather than procedures — see docs/reference/organization-plugin.md.
export class OrganizationPlugin {
  private constructor() {}

  public static create(
    memberships: MembershipReader,
    claimer: InvitationClaimer,
    founder: OrganizationFounder,
    maxOwnedOrganizations: number,
    linkClaimer: InvitationLinkClaimer,
  ): BetterAuthPlugin {
    return {
      id: "organization",
      endpoints: {
        switchOrganization: createAuthEndpoint(
          "/organization/switch",
          { method: "POST", body: switchBody, use: [sessionMiddleware], requireHeaders: true },
          async (ctx) => {
            const { session, user } = ctx.context.session;
            const organizationId = ctx.body.organizationId as OrganizationId;

            // The whole authorization. A session may only be rebound to a tenant this
            // person holds an *active* membership in; a deactivated one answers anonymous.
            if (!(await memberships.isActive(user.id as UserId, organizationId))) {
              throw new APIError("FORBIDDEN", {
                code: "NOT_A_MEMBER",
                message: "Not a member of that organization.",
              });
            }

            await OrganizationPlugin.rebind(ctx, session.token, user, organizationId);
            return ctx.json({ organizationId });
          },
        ),

        createOrganization: createAuthEndpoint(
          "/organization/create",
          { method: "POST", body: createBody, use: [sessionMiddleware], requireHeaders: true },
          async (ctx) => {
            const { session, user } = ctx.context.session;

            // The rate limit bounds the rate, not the total. Each call seeds four roles
            // and every permission the registry defines, so the total needs a bound too.
            if ((await memberships.ownedCount(user.id as UserId)) >= maxOwnedOrganizations) {
              throw new APIError("FORBIDDEN", {
                code: "ORGANIZATION_LIMIT_REACHED",
                message: "This account owns as many organizations as it may.",
              });
            }

            // The same founder the personal enroller uses, so an organization created
            // here is indistinguishable from one created at a first sign-in.
            const organizationId = await founder.found(user.id as UserId, ctx.body.name);

            await OrganizationPlugin.rebind(ctx, session.token, user, organizationId);
            return ctx.json({ organizationId });
          },
        ),

        acceptInvitation: createAuthEndpoint(
          "/invitation/accept",
          { method: "POST", body: acceptBody, use: [sessionMiddleware], requireHeaders: true },
          async (ctx) => {
            const { session, user } = ctx.context.session;

            // Null covers every refusal at once — unknown token, expired, revoked, sent
            // elsewhere, unverified. The landing page has already said which.
            const organizationId = await claimer.claimByToken(user.id as UserId, ctx.body.token);
            if (!organizationId) {
              throw new APIError("NOT_FOUND", {
                code: "INVITATION_NOT_CLAIMABLE",
                message: "That invitation cannot be accepted by this account.",
              });
            }

            await OrganizationPlugin.rebind(ctx, session.token, user, organizationId);
            return ctx.json({ organizationId });
          },
        ),

        // Wiremap's shareable invitation: the same shape as `acceptInvitation`, a link's
        // token instead of an emailed one. The verified address is checked by the claimer.
        acceptInvitationLink: createAuthEndpoint(
          "/invitation-link/accept",
          { method: "POST", body: acceptBody, use: [sessionMiddleware], requireHeaders: true },
          async (ctx) => {
            const { session, user } = ctx.context.session;

            const organizationId = await linkClaimer.claimByToken(
              user.id as UserId,
              ctx.body.token,
            );
            if (!organizationId) {
              throw new APIError("NOT_FOUND", {
                code: "INVITATION_LINK_NOT_CLAIMABLE",
                message: "That invitation link cannot be used by this account.",
              });
            }

            await OrganizationPlugin.rebind(ctx, session.token, user, organizationId);
            return ctx.json({ organizationId });
          },
        ),
      },
    };
  }

  // Row and Redis copy first, cookie cache last, so the very next request — RPC or SSR
  // — resolves the new tenant. See docs/reference/organization-plugin.md.
  private static async rebind(
    ctx: GenericEndpointContext,
    token: string,
    user: User,
    organizationId: OrganizationId,
  ): Promise<void> {
    const updated = await ctx.context.internalAdapter.updateSession(token, {
      activeOrganizationId: organizationId,
    });
    if (!updated) {
      throw new APIError("INTERNAL_SERVER_ERROR", { message: "The session could not be updated." });
    }

    // Where the next sign-in lands. `activeOrganizationFor` honours it only while the
    // membership still exists, so nothing here needs undoing later.
    await ctx.context.internalAdapter.updateUser(user.id, {
      lastActiveOrganizationId: organizationId,
    });

    await setSessionCookie(ctx, { session: updated, user });
  }
}
