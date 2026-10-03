import {
  eq,
  type OrganizationId,
  type OrganizationRecord,
  type OrganizationRepository,
  type Placement,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations } from "../schema/index.js";

export class PgOrganizationRepository extends BaseRepository implements OrganizationRepository {
  protected override readonly placement: Placement = "catalog";

  public async findById(organizationId: OrganizationId): Promise<OrganizationRecord | null> {
    const [row] = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        isPlatform: organizations.isPlatform,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row ? { ...row, id: row.id } : null;
  }

  public async rename(organizationId: OrganizationId, name: string): Promise<void> {
    await this.db.update(organizations).set({ name }).where(eq(organizations.id, organizationId));
  }
}
