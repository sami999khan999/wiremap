import {
  asc,
  eq,
  or,
  type PaginationQuery,
  type Placement,
  type ShardMapReader,
  type ShardNode,
  type ShardTenant,
  type ShardTenantPage,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations, shardAssignments, tenantRetentionPolicy } from "../schema/index.js";

// `shard_key` is opaque text so a fork can put a region in it; `organizations.id` is a
// uuid. The cast is here, once, rather than in three query builders.
const onOrganization = sql`${organizations.id}::text = ${shardAssignments.shardKey}`;

export class PgShardMapReader extends BaseRepository implements ShardMapReader {
  // The directory is what says where a tenant is, so it cannot be routed by one.
  protected override readonly placement: Placement = "catalog";

  public async nodes(): Promise<readonly ShardNode[]> {
    // The directory alone, not joined to `organizations`: this answers "what does the
    // directory say", and a row whose tenant is gone is exactly what that should show.
    const rows = await this.db
      .select({
        node: shardAssignments.node,
        tenants: sql<number>`count(*)::int`,
        // `mapWith`, because drizzle replaces node-postgres' timestamp parsers and converts
        // per column — an aggregate over one comes back as the raw string otherwise.
        lastAssignedAt: sql`max(${shardAssignments.assignedAt})`.mapWith(
          shardAssignments.assignedAt,
        ),
        lastMovedAt: sql`max(${shardAssignments.movedAt})`.mapWith(shardAssignments.movedAt),
      })
      .from(shardAssignments)
      .groupBy(shardAssignments.node)
      .orderBy(asc(shardAssignments.node));

    return rows;
  }

  public async tenantsOn(node: number, page: PaginationQuery): Promise<ShardTenantPage> {
    const rows = await this.db
      .select(PgShardMapReader.columns())
      .from(shardAssignments)
      .innerJoin(organizations, onOrganization)
      .where(eq(shardAssignments.node, node))
      // Name then id: a deterministic order is what makes `offset` mean the same thing
      // on the second page as it did on the first.
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(page.limit)
      .offset(page.offset);

    const totals = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(shardAssignments)
      .innerJoin(organizations, onOrganization)
      .where(eq(shardAssignments.node, node));

    return { items: rows, total: totals[0]?.total ?? 0 };
  }

  public async findByTerm(term: string): Promise<ShardTenant | null> {
    const rows = await this.db
      .select(PgShardMapReader.columns())
      .from(shardAssignments)
      .innerJoin(organizations, onOrganization)
      // `id::text`, never `$1::uuid`: a slug cast to a uuid is a `22P02` from the
      // database rather than the empty answer a typed search should get.
      .where(or(eq(organizations.slug, term), sql`${organizations.id}::text = ${term}`))
      .limit(1);

    return rows[0] ?? null;
  }

  // One scalar subquery per row rather than a grouped join: the page is bounded by
  // `limit`, and each lookup is the leading column of `tenant_retention_policy`'s key.
  private static columns() {
    return {
      organizationId: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      node: shardAssignments.node,
      assignedAt: shardAssignments.assignedAt,
      movedAt: shardAssignments.movedAt,
      retentionOverrides: sql<number>`(
        select count(*)::int from ${tenantRetentionPolicy}
        where ${tenantRetentionPolicy.organizationId} = ${organizations.id}
      )`,
    };
  }
}
