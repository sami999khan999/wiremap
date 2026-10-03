import {
  type ActivityLogger,
  and,
  CapabilitySet,
  type DomainEventPublisher,
  eq,
  Identifiers,
  type OrganizationId,
  type Placement,
  Principal,
  sql,
  Token,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { invitationLinks, memberships, organizations, roles, users } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// The same user-keyed lock `PgInvitationClaimer` and the enrollers take, so two joins
// for one person cannot both run.
const LOCK_NAMESPACE = 0x6c62_0001 | 0;

function lockKey(userId: string): number {
  return Number.parseInt(userId.replaceAll("-", "").slice(0, 8), 16) | 0;
}

// What the join page shows before the visitor signs in, and why a link no longer works.
export interface InvitationLinkPreview {
  readonly organizationName: string;
  readonly roleName: string;
  readonly usable: boolean;
}

// Not tenant-scoped: the tenant is the answer. What gates a claim is the verified address
// and the link being live. See docs/reference/enrollers.md.
export class PgInvitationLinkClaimer extends BaseRepository {
  protected override readonly placement: Placement = "catalog";

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly activity: ActivityLogger,
    private readonly events: DomainEventPublisher,
  ) {
    super(cluster, scope, shards);
  }

  public async preview(token: string): Promise<InvitationLinkPreview | null> {
    const [row] = await this.db
      .select({
        organizationName: organizations.name,
        roleName: roles.name,
        usable: PgInvitationLinkClaimer.LIVE,
      })
      .from(invitationLinks)
      .innerJoin(organizations, eq(organizations.id, invitationLinks.organizationId))
      .innerJoin(roles, eq(roles.id, invitationLinks.roleId))
      .where(eq(invitationLinks.tokenHash, await Token.hash(token)))
      .limit(1);
    return row ?? null;
  }

  // Null covers every refusal at once: unknown, expired, revoked, used up, unverified.
  public async claimByToken(userId: UserId, token: string): Promise<OrganizationId | null> {
    const tokenHash = await Token.hash(token);

    return this.cluster.catalog().client.transaction(async (tx) =>
      this.scope.within(tx, "catalog", async () => {
        await this.db.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${lockKey(userId)})`,
        );

        const [user] = await this.db
          .select({ emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user?.emailVerified) return null;

        // `for update`, so two people redeeming the last use of a link cannot both get in.
        const [link] = await this.db
          .select({
            id: invitationLinks.id,
            organizationId: invitationLinks.organizationId,
            roleId: invitationLinks.roleId,
          })
          .from(invitationLinks)
          .where(and(eq(invitationLinks.tokenHash, tokenHash), PgInvitationLinkClaimer.LIVE))
          .for("update")
          .limit(1);
        if (!link) return null;

        const inserted = await this.db
          .insert(memberships)
          .values({
            id: Uuid.v7(),
            organizationId: link.organizationId,
            userId,
            roleId: link.roleId,
          })
          .onConflictDoNothing()
          .returning({ id: memberships.id });

        // Already a member: the link opens the organization without spending a use.
        if (inserted.length === 0) return link.organizationId;

        await this.db
          .update(invitationLinks)
          .set({ uses: sql`${invitationLinks.uses} + 1` })
          .where(eq(invitationLinks.id, link.id));

        const joiner = new Principal(link.organizationId, userId, CapabilitySet.empty());
        await this.activity.record(joiner, "member.joined", {
          linkId: link.id,
          roleId: link.roleId,
        });
        await this.events.publish(joiner, {
          name: "member.joined",
          payload: { userId, roleId: Identifiers.roleId.parse(link.roleId) },
        });

        return link.organizationId;
      }),
    );
  }

  // Unexpired, unrevoked, with a use left. One expression for the preview and the claim, so
  // the page cannot promise what the claim then refuses.
  private static readonly LIVE = sql<boolean>`(${invitationLinks.expiresAt} > now()
    and ${invitationLinks.revokedAt} is null
    and (${invitationLinks.maxUses} is null or ${invitationLinks.uses} < ${invitationLinks.maxUses}))`;
}
