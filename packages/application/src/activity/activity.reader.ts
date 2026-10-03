import type { OrganizationId, UserId } from "../import.js";

export interface ActivityEntry {
  readonly id: string;
  readonly action: string;
  readonly actorId: UserId;
  readonly actorName: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface ActivityQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly action?: string;
  readonly actorId?: UserId;
  readonly from?: Date;
  readonly to?: Date;
  // Rows whose payload names this project. The project feed reads the same trail.
  readonly projectId?: string;
}

export interface ActivityPage {
  readonly items: readonly ActivityEntry[];
  readonly nextCursor: string | null;
}

// The read side of `ActivityLogger`: newest first, keyset-paged, one tenant at a time.
// A reader beside the slice, because nothing else adds a method to it.
export abstract class ActivityReader {
  public abstract list(organizationId: OrganizationId, query: ActivityQuery): Promise<ActivityPage>;
}
