import type { DomainEvent, OrganizationId } from "../import.js";

// No principal on any method — platform work, like `MaintenanceGateway`. Reachable from
// the worker only: nothing on a request path drains an outbox.
export abstract class OutboxGateway {
  // `relay` is called with a claimed batch and the rows are marked published only if it
  // resolves. At least once: a throw, or a crash mid-relay, hands the rows out again.
  public abstract drain(
    limit: number,
    relay: (events: readonly DomainEvent[]) => Promise<void>,
  ): Promise<number>;

  // The lag probe. Null when nothing is pending, which is the healthy answer and not a
  // missing one — an alert keyed on this must treat the two differently.
  public abstract oldestPendingAt(): Promise<Date | null>;

  // What the dropped foreign key used to do. `outbox_event` has no tenant level, so
  // dropping a tenant's partitions never reaches it — see decision `24.1`.
  public abstract deleteFor(organizationId: OrganizationId): Promise<number>;
}
