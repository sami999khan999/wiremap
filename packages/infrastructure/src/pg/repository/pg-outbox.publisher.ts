import {
  type Clock,
  type DomainEventInput,
  type DomainEventName,
  type DomainEventPublisher,
  type Placement,
  type Principal,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { outboxEvent } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

export class PgOutboxPublisher extends BaseRepository implements DomainEventPublisher {
  // Writes `outbox_event` inside whichever transaction is open.
  protected override readonly placement: Placement = "local";

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly clock: Clock,
  ) {
    super(cluster, scope, shards);
  }

  // Writes through `this.db`, so it joins whatever transaction is open. That is what
  // makes the state change and the event announcing it commit together or not at all.
  public async publish<N extends DomainEventName>(
    actor: Principal,
    event: DomainEventInput<N>,
  ): Promise<void> {
    await this.db.insert(outboxEvent).values({
      id: Uuid.v7(),
      organizationId: actor.organizationId,
      actorId: actor.userId,
      name: event.name,
      payload: { ...event.payload },
      occurredAt: this.clock.now(),
      // Null until the drain claims it. The absence of a timestamp *is* the queue.
      publishedAt: null,
    });
  }
}
