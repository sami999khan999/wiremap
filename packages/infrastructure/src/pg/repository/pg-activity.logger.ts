import type {
  ActivityLogger,
  Clock,
  Placement,
  Principal,
  RelayedActivity,
  RelayedActivityStore,
} from "../../import.js";
import { Shard, Uuid } from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { activityLog } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";
import { PgOutboxPublisher } from "./pg-outbox.publisher.js";

export class PgActivityLogger
  extends BaseRepository
  implements ActivityLogger, RelayedActivityStore
{
  // `activity_log` is on every node, written in whichever transaction is open.
  protected override readonly placement: Placement = "local";

  private readonly outbox: PgOutboxPublisher;

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly clock: Clock,
  ) {
    super(cluster, scope, shards);
    this.outbox = new PgOutboxPublisher(cluster, scope, shards, clock);
  }

  // Writes through `this.db`, so it joins whatever transaction is open. That is what
  // makes the state change and its audit row commit together or not at all.
  public async record(
    actor: Principal,
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    // Still inside the open transaction, so still saved with the action — only the
    // table differs. `ActivityRelaySubscriber` writes the row on the tenant's node.
    if (await this.isElsewhere(actor)) {
      await this.outbox.publish(actor, {
        name: "activity.recorded",
        payload: { entryId: Uuid.v7(), action, payload: { ...payload } },
      });
      return;
    }

    await this.db.insert(activityLog).values({
      id: Uuid.v7(),
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action,
      payload: { ...payload },
      occurredAt: this.clock.now(),
    });
  }

  // `onConflictDoNothing`, because the outbox is at-least-once and the key carries
  // the id and the time the event did.
  public async save(entry: RelayedActivity): Promise<void> {
    await this.db
      .insert(activityLog)
      .values({
        id: entry.id,
        organizationId: entry.organizationId,
        actorId: entry.actorId,
        action: entry.action,
        payload: { ...entry.payload },
        occurredAt: entry.occurredAt,
      })
      .onConflictDoNothing();
  }

  // `24.2a`. A catalog transaction is on node 0 whatever the tenant, so a tenant placed
  // on another node would get its row where its runway, archive and projection never look.
  private async isElsewhere(actor: Principal): Promise<boolean> {
    if (this.cluster.size === 1) return false;
    if (this.scope.current()?.placement !== "catalog") return false;

    // A placement already in scope for this tenant is the answer. The founder needs it:
    // its directory row is uncommitted, and the resolver reads through its own pool.
    const key = Shard.keyOf(actor.organizationId);
    const placed = this.shards.current();
    const node = placed?.key === key ? placed.node : await this.cluster.nodeOf(key);
    return node !== 0;
  }
}
