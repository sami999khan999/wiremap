import {
  eq,
  InternalError,
  type OrganizationId,
  type Placement,
  type PlatformOrganization,
  type PlatformReader,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations } from "../schema/index.js";

export class PgPlatformReader extends BaseRepository implements PlatformReader {
  // `organizations`, read before any key is known.
  protected override readonly placement: Placement = "catalog";

  // `organizations_platform_uq` guarantees at most one, and `pnpm db:seed` guarantees at
  // least one — so a miss here is a database nobody seeded, not a case to branch on.
  public async organizationId(): Promise<OrganizationId> {
    return (await this.organization()).id;
  }

  public async organization(): Promise<PlatformOrganization> {
    const rows = await this.db
      .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.isPlatform, true))
      .limit(1);

    const row = rows[0];
    if (!row) throw new InternalError(new Error("No organization is marked is_platform."));

    return row;
  }
}
