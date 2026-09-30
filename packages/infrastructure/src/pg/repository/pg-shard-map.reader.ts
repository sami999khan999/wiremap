import {
  eq,
  or,
  type Placement,
  type ShardMapReader,
  type ShardTenant,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations, shardAssignments } from "../schema/index.js";

// `shard_key` is opaque text so a fork can put a region in it; `organizations.id` is a
// uuid. The cast is here, once, rather than in each query builder.
const onOrganization = sql`${organizations.id}::text = ${shardAssignments.shardKey}`;

export class PgShardMapReader extends BaseRepository implements ShardMapReader {
  // The directory is what says where a tenant is, so it cannot be routed by one.
  protected override readonly placement: Placement = "catalog";

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

  private static columns() {
    return {
      organizationId: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      node: shardAssignments.node,
      assignedAt: shardAssignments.assignedAt,
      movedAt: shardAssignments.movedAt,
    };
  }
}
