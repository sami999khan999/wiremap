import {
  type ActivityLogger,
  and,
  asc,
  CapabilitySet,
  type DomainEventPublisher,
  eq,
  gt,
  Identifiers,
  type OrganizationId,
  type Placement,
  Principal,
  type SQL,
  sql,
  Token,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { invitations, memberships, organizations, users } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// The same user-keyed lock the personal enroller takes, so a claim and an enrolment for
// one new user cannot both succeed.
const LOCK_NAMESPACE = 0x6c62_0001 | 0;

function lockKey(userId: string): number {
  return Number.parseInt(userId.replaceAll("-", "").slice(0, 8), 16) | 0;
}

// What the landing page renders before anyone is signed in. The same shape
// `InvitationClaimer` in `auth` declares, restated because this package cannot import it.
export interface InvitationPreview {
  readonly organizationName: string;
  readonly email: string;
  readonly expired: boolean;
}

// Deliberately not tenant-scoped — the tenant is the *answer*. What scopes a claim is the
// verified-address check below. See docs/reference/enrollers.md.
export class PgInvitationClaimer extends BaseRepository {
  // `invitations` and `memberships`, both catalog, in one transaction.
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

  // Hashed on the way in, always: the column holds a digest, so a raw token matches
  // nothing and a lookup written against it would silently find no invitation.
  public async preview(token: string): Promise<InvitationPreview | null> {
    const tokenHash = await Token.hash(token);

    const [row] = await this.db
      .select({
        organizationName: organizations.name,
        email: invitations.email,
        // Database time — the same clock the claim below compares against.
        expired: sql<boolean>`${invitations.expiresAt} <= now()`,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(eq(invitations.tokenHash, tokenHash))
      .limit(1);

    return row ?? null;
  }

  public async claimByToken(userId: UserId, token: string): Promise<OrganizationId | null> {
    return this.claim(userId, eq(invitations.tokenHash, await Token.hash(token)));
  }

  public claimPending(userId: UserId): Promise<OrganizationId | null> {
    return this.claim(userId);
  }

  private async claim(userId: UserId, match?: SQL): Promise<OrganizationId | null> {
    return this.cluster.catalog().client.transaction(async (tx) =>
      this.scope.within(tx, "catalog", async () => {
        await this.db.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${lockKey(userId)})`,
        );

        const [user] = await this.db
          .select({ email: users.email, emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        // The security property, and the only one: the mailbox is the credential and the
        // token a lookup key. Under `AUTH_REQUIRE_EMAIL_VERIFICATION=false` it fails closed.
        if (!user?.emailVerified) return null;

        const [invitation] = await this.db
          .select({
            id: invitations.id,
            organizationId: invitations.organizationId,
            roleId: invitations.roleId,
          })
          .from(invitations)
          .where(
            and(
              // The column, not `lower()` over it: `invitations.email` is stored
              // lowercased, and wrapping it makes `invitations_email_idx` unusable.
              eq(invitations.email, user.email.toLowerCase()),
              gt(invitations.expiresAt, sql`now()`),
              match,
            ),
          )
          .orderBy(asc(invitations.createdAt))
          .limit(1);

        if (!invitation) return null;

        // Idempotent under `memberships_uq (organization_id, user_id)`: someone who is
        // already a member keeps the role they have, and the invitation is consumed.
        await this.db
          .insert(memberships)
          .values({
            id: Uuid.v7(),
            organizationId: invitation.organizationId,
            userId,
            roleId: invitation.roleId,
          })
          .onConflictDoNothing();

        await this.db.delete(invitations).where(eq(invitations.id, invitation.id));

        // Written as the tenant being joined — the fact is theirs, not the actor's
        // current organization's. The same construction `PgOrganizationFounder` uses.
        const joiner = new Principal(invitation.organizationId, userId, CapabilitySet.empty());
        await this.activity.record(joiner, "member.joined", {
          invitationId: invitation.id,
          roleId: invitation.roleId,
        });

        // Inside the same transaction as the membership row, which is the whole point.
        await this.events.publish(joiner, {
          name: "member.joined",
          payload: { userId, roleId: Identifiers.roleId.parse(invitation.roleId) },
        });

        return invitation.organizationId;
      }),
    );
  }
}
