import {
  type ActivityLogger,
  and,
  CapabilitySet,
  eq,
  InternalError,
  type Logger,
  type OrganizationId,
  type Placement,
  Principal,
  Shard,
  sql,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { memberships, organizations, roles, shardAssignments } from "../schema/index.js";
import { SystemRoleSeed, TenantPartitionSeed } from "../seed/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// The role the person who founds a tenant gets. There is no second branch: a founded
// organization has exactly one member.
const FOUNDER_ROLE = "owner";

// The same shape `OrganizationFounder` in `auth` declares, restated because this package
// cannot import it — the same reason `InvitationPreview` is restated.
export interface OrganizationFounder {
  found(userId: UserId, name: string, slug?: string): Promise<OrganizationId>;
}

// One implementation of "create a tenant and own it", called from the personal enroller
// and from the create endpoint. See docs/reference/enrollers.md.
export class PgOrganizationFounder extends BaseRepository {
  // `organizations` and the RBAC it seeds, in one transaction.
  protected override readonly placement: Placement = "catalog";

  private readonly systemRoles = new SystemRoleSeed(this.cluster, this.scope, this.shards);
  private readonly partitions = new TenantPartitionSeed(this.cluster, this.scope, this.shards);

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly activity: ActivityLogger,
    private readonly logger: Logger,
  ) {
    super(cluster, scope, shards);
  }

  // `this.db`, not `this.database.client`: inside the enroller's transaction this is a
  // savepoint, standalone it is a transaction of its own.
  public async found(userId: UserId, name: string, slug?: string): Promise<OrganizationId> {
    const founded = await this.db.transaction(async (tx) =>
      this.scope.within(tx, "catalog", async () => {
        // A spare when there is one — its partitions exist, so `run` below finds nothing
        // to make. Rolled back with the rest, so a failed signup returns it to the pool.
        const organizationId = (await this.claimSpare()) ?? (Uuid.v7() as OrganizationId);

        await this.db.insert(organizations).values({
          id: organizationId,
          // Derived from an id, never from the name: a slug built from user input needs
          // a normalisation pass and a collision strategy, and nothing routes by slug.
          slug: slug ?? `o-${organizationId}`,
          name,
          // The platform's choice for a new signup (`RV.14`). The column default only placed
          // the orgs that existed; the policy row may not exist yet, hence the fallback.
          planKey: sql`coalesce((select default_plan_key from platform_policy where id = 1), 'unlimited')`,
        });

        // **Inside the transaction that creates the tenant**, which is what lets
        // `PgShardResolver` throw on a missing row rather than guess node 0.
        await this.db
          .insert(shardAssignments)
          .values({ shardKey: organizationId, node: 0 })
          .onConflictDoNothing();

        // Before anything writes a tenant-owned row: `activity.record` below writes into
        // one of those partitioned tables inside this same transaction. One read for a
        // ──
        // spare, which still needs it: a spare made last month may be a month short.
        await this.partitions.run(organizationId);

        // Reused, not reimplemented, so an organization created here holds exactly the
        // grants `pnpm db:seed` would have given it.
        await this.systemRoles.run(organizationId);

        const [role] = await this.db
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.organizationId, organizationId), eq(roles.key, FOUNDER_ROLE)))
          .limit(1);

        // Unreachable unless `SystemRoleSeed` stops defining `owner`. Throwing rolls
        // the whole tenant back, which beats a tenant nobody can administer.
        if (!role) throw new InternalError(new Error("SystemRoleSeed defines no owner role."));

        await this.db
          .insert(memberships)
          .values({ id: Uuid.v7(), organizationId, userId, roleId: role.id });

        // The tenant just created, not the caller's. An empty capability set: the logger
        // reads only the organization and the actor off it.
        // ──
        // Placed on node 0, where the row above put it: the resolver reads through its own
        // pool and cannot see that row until this commits. See docs/reference/sharding.md.
        await this.shards.within({ key: Shard.keyOf(organizationId), node: 0 }, () =>
          this.activity.record(
            new Principal(organizationId, userId, CapabilitySet.empty()),
            "organization.created",
            { name },
          ),
        );

        return organizationId;
      }),
    );

    // After the commit, never inside it: a rolled-back transaction would otherwise leave
    // a line saying a tenant was placed on a node it never reached.
    this.logger.emit("shard.assignment.created", { key: founded, node: 0 });
    return founded;
  }

  // The oldest spare, and never one another signup holds: `SKIP LOCKED` makes a busy
  // pool fall through to the inline seed rather than queue two signups behind one row.
  private async claimSpare(): Promise<OrganizationId | null> {
    const claimed = await this.db.execute<{ id: OrganizationId }>(sql`
      delete from spare_tenants
      where id = (
        select id from spare_tenants
        order by created_at
        limit 1
        for update skip locked
      )
      returning id::text as id
    `);

    return claimed.rows[0]?.id ?? null;
  }
}
