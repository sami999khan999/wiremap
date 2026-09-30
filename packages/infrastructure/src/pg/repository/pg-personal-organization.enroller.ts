import { eq, type OrganizationId, type Placement, sql, type UserId } from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { memberships, users } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";
import type { OrganizationFounder } from "./pg-organization.founder.js";

// The same fixed namespace the bootstrap enroller and the claimer use, so a claim and an
// enrolment for one user serialise against each other.
const LOCK_NAMESPACE = 0x6c62_0001 | 0;

// Keyed on the *user*, because the organization does not exist yet: losing that race
// means two organizations for one person and a hook free to pick either.
function lockKey(userId: string): number {
  return Number.parseInt(userId.replaceAll("-", "").slice(0, 8), 16) | 0;
}

// The `personal` mode: a new user owns an organization of their own, so a fresh clone
// needs no seed and no invitation. See docs/reference/enrollers.md.
export class PgPersonalOrganizationEnroller extends BaseRepository {
  // `organizations` and `memberships`, in one transaction.
  protected override readonly placement: Placement = "catalog";

  // Must share this repository's `TransactionScope`, or the founder's savepoint opens
  // on the pool instead of inside the locked transaction below.
  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly founder: OrganizationFounder,
  ) {
    super(cluster, scope, shards);
  }

  // Runs once per user, on the first session they ever open — `activeOrganizationFor`
  // answers on every one after that, so none of this is on the sign-in path.
  public async enrol(userId: UserId): Promise<OrganizationId | null> {
    return this.cluster.catalog().client.transaction(async (tx) =>
      this.scope.within(tx, "catalog", async () => {
        await this.db.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${lockKey(userId)})`,
        );

        // Idempotent, and checked inside the lock: a retried request must return the
        // organization the first attempt created rather than create a second one.
        const [existing] = await this.db
          .select({ organizationId: memberships.organizationId })
          .from(memberships)
          .where(eq(memberships.userId, userId))
          .limit(1);

        // Cast for the same reason `PgMembershipReader` casts: `memberships` declares
        // its FK as a plain `uuid`, and the brand lives on `organizations.id`.
        if (existing) return existing.organizationId as OrganizationId;

        const [user] = await this.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        // The hook that calls this runs inside session creation, so the row is always
        // there. Declining rather than inventing a name keeps that assumption visible.
        if (!user) return null;

        // Their own name, so this package writes no English; the slug from their id,
        // because a slug built from a name needs a collision strategy.
        return this.founder.found(userId, user.name, `u-${userId}`);
      }),
    );
  }
}
