import type { OrganizationId } from "../import.js";

// Enough of the tier to name it on a screen. Not the whole row: nothing above this
// needs its creation date, and a reader that returns one invites a second caller.
export interface PlatformOrganization {
  readonly id: OrganizationId;
  readonly slug: string;
  readonly name: string;
}

// Which organization is the platform tier. One row, marked by the seed and guaranteed
// unique by a partial index, so this is a lookup rather than a decision.
export abstract class PlatformReader {
  // Throws rather than returning null: "no platform organization" is a broken
  // deployment, not a case to branch on. Read on every RBAC write, hence the id alone.
  public abstract organizationId(): Promise<OrganizationId>;

  public abstract organization(): Promise<PlatformOrganization>;
}
