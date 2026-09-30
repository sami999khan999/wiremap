import type { OrganizationId } from "../import.js";

// What a delete needs to decide and to name. Not the whole row: a second caller
// wanting a creation date would add a reader beside this, not a field to it.
export interface TenantRecord {
  readonly id: OrganizationId;
  readonly slug: string;
  readonly name: string;
  readonly isPlatform: boolean;
}

// The tenant row itself, as a platform admin acts on it. `PlatformReader` beside this
// answers "which one is the tier"; this one answers "what is this one, and remove it".
export abstract class TenantRepository {
  // Null rather than a throw: the use-case turns it into `NOT_FOUND`, which is also
  // the right answer for a tenant a previous call already deleted.
  public abstract findBy(organizationId: OrganizationId): Promise<TenantRecord | null>;

  // The catalog cascade is the point of this one statement: `api_keys`, `sessions`,
  // `invitations`, `roles`, `memberships` and the rest go with the row.
  public abstract delete(organizationId: OrganizationId): Promise<void>;
}
