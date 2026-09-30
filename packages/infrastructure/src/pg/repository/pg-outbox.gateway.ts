import {
  type DomainEvent,
  type DomainEventName,
  type OrganizationId,
  type OutboxGateway,
  type Placement,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";

// `occurred_at` is a string, and the `::text` casts below are what make that true rather
// than accidental: `execute` returns driver rows, which drizzle's date mapping never sees.
interface PendingRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly actor_id: string;
  readonly name: string;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: string;
}

// How long a claimed batch is someone else's. A drain that dies between relay and mark
// frees its rows after this; the relayed jobs dedupe by id when they are relayed again.
const LEASE_SECONDS = 60;

export class PgOutboxGateway extends BaseRepository implements OutboxGateway {
  // `outbox_event` is on every node, drained per node.
  protected override readonly placement: Placement = "local";

  // Claim, relay, mark — three statements, with no transaction open across the relay's
  // Redis round trips. See packages/application/docs/reference/ports.md.
  public async drain(
    limit: number,
    relay: (events: readonly DomainEvent[]) => Promise<void>,
  ): Promise<number> {
    // One auto-committed statement. `SKIP LOCKED` lets replicas share the drain with no
    // coordinator, and the lease keeps a row another replica is relaying out of reach.
    const claimed = await this.db.execute<PendingRow>(sql`
      update outbox_event o
      set claimed_until = now() + make_interval(secs => ${LEASE_SECONDS})
      from (
        select id, occurred_at
        from outbox_event
        where published_at is null
          and (claimed_until is null or claimed_until < now())
        order by occurred_at, id
        limit ${limit}
        for update skip locked
      ) c
      where o.id = c.id and o.occurred_at = c.occurred_at
      returning o.id, o.organization_id, o.actor_id, o.name, o.payload,
        o.occurred_at::text as occurred_at
    `);

    // `returning` has no order, and the relay publishes in the order it is handed.
    const rows = [...claimed.rows].sort((a, b) =>
      a.occurred_at === b.occurred_at
        ? a.id.localeCompare(b.id)
        : new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    );
    if (rows.length === 0) return 0;

    const batch = sql.raw(PgOutboxGateway.tuples(rows));

    try {
      await relay(rows.map((row) => PgOutboxGateway.toEvent(row)));
    } catch (error) {
      // Released now rather than at the lease's end, so a queue that was down for a
      // second costs the next tick, not a minute.
      await this.db.execute(sql`
        update outbox_event set claimed_until = null
        where published_at is null and (id, occurred_at) in ${batch}
      `);
      throw error;
    }

    // `published_at is null` again, so a row another replica somehow marked in between is
    // left alone rather than re-stamped.
    await this.db.execute(sql`
      update outbox_event
      set published_at = now(), claimed_until = null
      where published_at is null
        and (id, occurred_at) in ${batch}
    `);

    return rows.length;
  }

  public async oldestPendingAt(): Promise<Date | null> {
    const result = await this.db.execute<{ occurred_at: string | null }>(sql`
      select min(occurred_at)::text as occurred_at from outbox_event where published_at is null
    `);

    // Parsed here, not handed back as it arrived: the caller compares it to a cutoff, and
    // `string < Date` is false for every value, so the retention guard would never fire.
    const oldest = result.rows[0]?.occurred_at;
    return oldest ? new Date(oldest) : null;
  }

  // What `outbox_event_organization_id_organizations_id_fk` used to do before `24.1`
  // dropped it. This table has no tenant level, so no partition drop reaches its rows.
  public async deleteFor(organizationId: OrganizationId): Promise<number> {
    // `this.db`, not `catalogDb`: the table is `local`, so the rows are on whichever
    // node the caller is placed on — which for the purge job is the tenant's own.
    const result = await this.db.execute(
      sql`delete from outbox_event where organization_id = ${organizationId}`,
    );

    return result.rowCount ?? 0;
  }

  // Inlined because Postgres accepts no bind parameter for a row-constructor list of
  // unknown length. Every value is a uuid or a timestamp this process just read back.
  private static tuples(rows: readonly PendingRow[]): string {
    const values = rows
      .map((row) => `('${row.id}'::uuid, '${row.occurred_at}'::timestamptz)`)
      .join(", ");

    return `(${values})`;
  }

  private static toEvent(row: PendingRow): DomainEvent {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name as DomainEventName,
      actorId: row.actor_id,
      occurredAt: new Date(row.occurred_at),
      payload: row.payload,
    } as DomainEvent;
  }
}
