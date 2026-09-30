import {
  eq,
  type OrganizationId,
  type Placement,
  type TenantRecord,
  type TenantRepository,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations, shardAssignments } from "../schema/index.js";

export class PgTenantRepository extends BaseRepository implements TenantRepository {
  // `organizations` is the catalog's own table.
  protected override readonly placement: Placement = "catalog";

  public async findBy(organizationId: OrganizationId): Promise<TenantRecord | null> {
    const rows = await this.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        isPlatform: organizations.isPlatform,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    return rows[0] ?? null;
  }

  // Two statements, because one of the two tables cannot cascade. Every referring table
  // has `ON DELETE CASCADE`; the seven partitioned ones are dropped before this runs.
  public async delete(organizationId: OrganizationId): Promise<void> {
    // The directory carries no foreign key on purpose — `shard_key` is opaque text, so a
    // fork can put a region in it — which means nothing cascades and this is the sweep.
    await this.db.delete(shardAssignments).where(eq(shardAssignments.shardKey, organizationId));

    await this.db.delete(organizations).where(eq(organizations.id, organizationId));
  }
}
