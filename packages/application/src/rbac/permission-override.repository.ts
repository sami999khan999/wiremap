import type { OrganizationId, UserId } from "../import.js";
import type { OverrideRecord } from "./capability.repository.js";

// One person's override as the screens and the sweep need it: the explanation's row, plus
// whose it is and when it was written.
export interface PermissionOverrideRecord extends OverrideRecord {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly createdAt: Date;
}

export interface OverrideInput {
  readonly permission: string;
  readonly effect: "grant" | "deny";
  readonly reason: string | null;
  // Null for a deny, which never lapses; required for a grant, which the CHECK enforces.
  readonly expiresAt: Date | null;
  // `platform` only from the tier's own deny (Phase 6). An org write is always `org`.
  readonly authority: "org" | "platform";
}

// Org-scope overrides — the rows with no goal. Goal-scoped ones exist in the table and are
// resolved, but nothing writes them yet, and a port that pretended to would lie.
export abstract class PermissionOverrideRepository {
  // Live rows only, both authorities: an expired grant is not an exception any more.
  public abstract findFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly PermissionOverrideRecord[]>;

  // Under the tenant, so an id from another organization is null.
  public abstract findById(
    organizationId: OrganizationId,
    id: string,
  ): Promise<PermissionOverrideRecord | null>;

  // Upserted on `(organization, user, permission, authority)`: a grant replaces the org's
  // deny of the same key, and never touches the platform's.
  public abstract save(
    organizationId: OrganizationId,
    userId: UserId,
    rows: readonly OverrideInput[],
    actor: UserId,
  ): Promise<void>;

  public abstract delete(organizationId: OrganizationId, id: string): Promise<void>;

  // Every org's grants at or past `now`, for the worker's sweep.
  public abstract findExpired(now: Date): Promise<readonly PermissionOverrideRecord[]>;
}
