import {
  type DomainEvent,
  type DomainEventName,
  type OrganizationId,
  OutboxGateway,
  Uuid,
} from "../import.js";

// Honours the relay contract rather than approximating it: rows are removed only when
// `relay` resolves, so a spec can assert that a failing subscriber leaves work behind.
export class InMemoryOutboxGateway extends OutboxGateway {
  private readonly pending: DomainEvent[] = [];

  // The test-side counterpart of `PgOutboxPublisher`, so a spec can seed the outbox
  // without naming a table.
  public enqueue<N extends DomainEventName>(
    event: Omit<DomainEvent<N>, "id"> & { readonly id?: string },
  ): void {
    // Generic over the name so the payload still has to match it. The assertion is the
    // last step only: `Omit` over a union does not put one back together.
    this.pending.push({ ...event, id: event.id ?? Uuid.v7() } as DomainEvent);
  }

  public override async drain(
    limit: number,
    relay: (events: readonly DomainEvent[]) => Promise<void>,
  ): Promise<number> {
    const batch = this.pending.slice(0, limit);
    if (batch.length === 0) return 0;

    // Awaited before anything is removed. A throw here leaves every row claimed and
    // pending, which is what the transactional adapter does by rolling back.
    await relay(batch);
    this.pending.splice(0, batch.length);

    return batch.length;
  }

  public override oldestPendingAt(): Promise<Date | null> {
    const oldest = this.pending.reduce<Date | null>(
      (earliest, event) =>
        earliest === null || event.occurredAt < earliest ? event.occurredAt : earliest,
      null,
    );
    return Promise.resolve(oldest);
  }

  // What the dropped foreign key used to do. A spec asserting the purge swept the
  // outbox needs this to actually remove rows, not to report a number.
  public override deleteFor(organizationId: OrganizationId): Promise<number> {
    const before = this.pending.length;
    for (let at = this.pending.length - 1; at >= 0; at -= 1) {
      if (this.pending[at]?.organizationId === organizationId) this.pending.splice(at, 1);
    }

    return Promise.resolve(before - this.pending.length);
  }

  public remaining(): readonly DomainEvent[] {
    return this.pending;
  }
}
