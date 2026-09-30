import {
  and,
  asc,
  eq,
  exists,
  gt,
  type OrganizationId,
  type OrganizationReader,
  type Placement,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations, shardAssignments } from "../schema/index.js";

// The catalog read every per-tenant loop starts from, and the one read in this system
// that is cross-tenant by definition rather than by accident.
export class PgOrganizationReader extends BaseRepository implements OrganizationReader {
  // `organizations` is the catalog's own table.
  protected override readonly placement: Placement = "catalog";

  public async page(
    after: OrganizationId | null,
    limit: number,
    onNode?: number,
  ): Promise<readonly OrganizationId[]> {
    // Still one query with the node filter on: a sweep that paged every tenant and
    // discarded the rest would read the whole table once per node.
    const rows = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          after ? gt(organizations.id, after) : undefined,
          onNode === undefined ? undefined : this.placedOn(onNode),
        ),
      )
      .orderBy(asc(organizations.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  public async nameOf(organizationId: OrganizationId): Promise<string | null> {
    const rows = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    return rows[0]?.name ?? null;
  }

  // A correlated `EXISTS` rather than a join, so the projection and the keyset stay
  // exactly what they are without it — the filter is the only difference.
  private placedOn(node: number) {
    return exists(
      this.db
        .select({ present: shardAssignments.node })
        .from(shardAssignments)
        .where(
          and(
            eq(shardAssignments.shardKey, sql`${organizations.id}::text`),
            eq(shardAssignments.node, node),
          ),
        ),
    );
  }
}
