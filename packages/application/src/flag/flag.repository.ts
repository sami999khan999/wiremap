import type { OrganizationId, UserId } from "../import.js";

// One row per flag anyone has switched. The key is a string, not a `FlagKey`: a row can
// outlive the declaration it names, and the platform screen shows it as orphaned.
export interface FlagTarget {
  readonly organizationId: OrganizationId;
  // For the platform screen, which lists targets by the name an operator recognises.
  readonly slug: string;
}

export interface FlagRecord {
  readonly key: string;
  readonly isEnabled: boolean;
  readonly targets: readonly FlagTarget[];
  readonly updatedAt: Date | null;
}

export abstract class FlagRepository {
  // Every row and every target, in one read. The whole state is small, and the cache
  // holds it under one key rather than one per org.
  public abstract findAll(): Promise<readonly FlagRecord[]>;

  public abstract save(key: string, isEnabled: boolean, actor: UserId): Promise<void>;

  // Creates the flag row, off, when it does not exist yet: a target needs a row to hang on.
  public abstract saveTarget(
    key: string,
    organizationId: OrganizationId,
    actor: UserId,
  ): Promise<void>;

  public abstract deleteTarget(key: string, organizationId: OrganizationId): Promise<void>;
}
