import {
  type ActivityLogger,
  CapabilitySet,
  type DomainEventPublisher,
  eq,
  Identifiers,
  MemberDomainRules,
  type OrganizationId,
  type Placement,
  Principal,
  sql,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { memberships, organizationDomains, users } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

const LOCK_NAMESPACE = 0x6c62_0001 | 0;

function lockKey(userId: string): number {
  return Number.parseInt(userId.replaceAll("-", "").slice(0, 8), 16) | 0;
}

// Auto-join at enrolment: a person with no membership yet, whose verified address is at
// a claimed domain, joins that organization with the domain's role.
export class PgMemberDomainClaimer extends BaseRepository {
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

  public async claimByDomain(userId: UserId): Promise<OrganizationId | null> {
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
        // The verified mailbox is the whole credential, as it is for an invitation.
        if (!user?.emailVerified) return null;

        const domain = MemberDomainRules.domainOf(user.email);
        if (!domain) return null;

        const [claim] = await this.db
          .select({
            id: organizationDomains.id,
            organizationId: organizationDomains.organizationId,
            roleId: organizationDomains.roleId,
          })
          .from(organizationDomains)
          .where(eq(organizationDomains.domain, domain))
          .limit(1);
        if (!claim) return null;

        await this.db
          .insert(memberships)
          .values({
            id: Uuid.v7(),
            organizationId: claim.organizationId,
            userId,
            roleId: claim.roleId,
          })
          .onConflictDoNothing();

        const joiner = new Principal(claim.organizationId, userId, CapabilitySet.empty());
        await this.activity.record(joiner, "member.joined", {
          domainId: claim.id,
          roleId: claim.roleId,
        });
        await this.events.publish(joiner, {
          name: "member.joined",
          payload: { userId, roleId: Identifiers.roleId.parse(claim.roleId) },
        });

        return claim.organizationId;
      }),
    );
  }
}
