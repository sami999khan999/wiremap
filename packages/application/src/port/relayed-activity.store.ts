import type { OrganizationId, UserId } from "../import.js";

// One audit row that reached its tenant's node through the outbox, carrying the id and
// the time it was recorded with. The relay writes it; nothing else may backdate a row.
export interface RelayedActivity {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly actorId: UserId;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

// `24.2a`. A catalog transaction runs on node 0, so the audit row for a tenant placed on
// another node is published instead and written here, on the tenant's own node.
export abstract class RelayedActivityStore {
  // Idempotent on the row's id: the outbox delivers at least once.
  public abstract save(entry: RelayedActivity): Promise<void>;
}
