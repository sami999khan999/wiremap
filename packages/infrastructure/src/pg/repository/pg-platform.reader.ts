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

  // Remembered for the life of the process: the mark never moves once seeded, and every
  // platform docs read asks for it several times. A failed lookup is not remembered.
  private remembered: Promise<PlatformOrganization> | null = null;

  // `organizations_platform_uq` guarantees at most one, and `pnpm db:seed` guarantees at
  // least one — so a miss here is a database nobody seeded, not a case to branch on.
  public async organizationId(): Promise<OrganizationId> {
    return (await this.organization()).id;
  }

  public organization(): Promise<PlatformOrganization> {
    this.remembered ??= this.lookup().catch((error: unknown) => {
      this.remembered = null;
      throw error;
    });
    return this.remembered;
  }

  private async lookup(): Promise<PlatformOrganization> {
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
