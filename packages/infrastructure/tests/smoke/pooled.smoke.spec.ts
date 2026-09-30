import { afterAll, describe, expect, inject, it } from "vitest";
import { sql } from "../../src/import.js";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgOutboxGateway } from "../../src/pg/repository/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import type {} from "./support/stack.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

const stack = inject("stack");

// Two arguments, which is the overload every enroller and the claimer uses. A single
// bigint is a different lock namespace and would prove nothing about the code that ships.
const LOCK_NAMESPACE = 918_273;
const LOCK_KEY = 4_242;

// Long enough that the second holder is provably waiting rather than merely slower.
const HOLD_MS = 700;

const open = (url: string, statementTimeoutMs?: number) => {
  const database = new Database(statementTimeoutMs ? { url, statementTimeoutMs } : { url });
  const scope = new TransactionScope();
  // The same value on both: the startup parameter for a direct connection, the `SET LOCAL`
  // for a pooled one. Only the second survives pgBouncer.
  return {
    database,
    scope,
    unitOfWork: new PgUnitOfWork(
      DatabaseCluster.single(database),
      scope,
      shards,
      "catalog",
      statementTimeoutMs ? { statementTimeoutMs } : {},
    ),
  };
};

const pooled = open(stack.database.url);
const second = open(stack.database.url);
const direct = open(stack.database.directUrl);

afterAll(async () => {
  await Promise.all([pooled.database.close(), second.database.close(), direct.database.close()]);
});

const show = async (setting: string, url: string) => {
  const handle = url === stack.database.url ? pooled : direct;
  const result = await handle.database.client.execute<Record<string, string>>(
    sql.raw(`show ${setting}`),
  );
  return result.rows[0]?.[setting];
};

describe("the pooled connection path", () => {
  // The whole reason migration 0022 exists. Through a transaction pooler the startup
  // parameter is dropped, so this reads the role setting or it reads `0`.
  it("carries a statement timeout that a transaction pooler cannot drop", async () => {
    expect(await show("statement_timeout", stack.database.url)).not.toBe("0");
  });

  // `SET LOCAL` rather than `SET`: the value must die with the transaction, or it follows
  // the server connection to whoever pgBouncer hands it to next.
  it("raises the timeout inside run and restores it after", async () => {
    const worker = open(stack.database.url, 25_000);

    try {
      const before = await worker.database.client.execute<{ statement_timeout: string }>(
        sql`show statement_timeout`,
      );

      await worker.unitOfWork.run(async () => {
        const inScope = worker.scope.current();
        if (!inScope) throw new Error("no transaction in scope");
        const tx = inScope.client;
        const inside = await tx.execute<{ statement_timeout: string }>(sql`show statement_timeout`);
        expect(inside.rows[0]?.statement_timeout).toBe("25s");
      });

      const after = await worker.database.client.execute<{ statement_timeout: string }>(
        sql`show statement_timeout`,
      );
      expect(after.rows[0]?.statement_timeout).toBe(before.rows[0]?.statement_timeout);
    } finally {
      await worker.database.close();
    }
  });

  // A savepoint, not a second connection. Through a pooler the failure mode is worse than
  // locally: a second connection is a second *server* connection, in its own transaction.
  it("rolls a nested run back to a savepoint and keeps the outer work", async () => {
    const table = `probe_pooled_${Date.now()}`;
    await pooled.database.client.execute(sql.raw(`create table ${table} (n int)`));

    try {
      await pooled.unitOfWork.run(async () => {
        const inScope = pooled.scope.current();
        if (!inScope) throw new Error("no transaction in scope");
        const tx = inScope.client;
        await tx.execute(sql.raw(`insert into ${table} values (1)`));

        await expect(
          pooled.unitOfWork.run(async () => {
            await pooled.scope
              .current()
              ?.client.execute(sql.raw(`insert into ${table} values (2)`));
            throw new Error("inner");
          }),
        ).rejects.toThrow("inner");

        await tx.execute(sql.raw(`insert into ${table} values (3)`));
      });

      const rows = await pooled.database.client.execute<{ n: number }>(
        sql.raw(`select n from ${table} order by n`),
      );
      expect(rows.rows.map((row) => row.n)).toEqual([1, 3]);
    } finally {
      await pooled.database.client.execute(sql.raw(`drop table if exists ${table}`));
    }
  });

  // Transaction-scoped, so the pooler releases the server connection and the lock with it.
  // A session-level `pg_advisory_lock` here would leak the lock to the next client.
  it("serialises two callers on pg_advisory_xact_lock", async () => {
    const order: string[] = [];

    const first = pooled.unitOfWork.run(async () => {
      await pooled.scope
        .current()
        ?.client.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${LOCK_KEY})`);
      order.push("first-acquired");
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      order.push("first-released");
    });

    // After a beat, so the second caller provably asks while the first still holds it.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const waiting = second.unitOfWork.run(async () => {
      await second.scope
        .current()
        ?.client.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${LOCK_KEY})`);
      order.push("second-acquired");
    });

    await Promise.all([first, waiting]);
    expect(order).toEqual(["first-acquired", "first-released", "second-acquired"]);
  });

  // `FOR UPDATE SKIP LOCKED` is what lets two worker replicas share a drain with no
  // coordinator, and it is row locks inside a transaction — the shape a pooler preserves.
  it("claims disjoint rows when two callers drain the outbox", async () => {
    const [org] = (
      await pooled.database.client.execute<{ id: string }>(
        sql`select id from organizations limit 1`,
      )
    ).rows;
    if (!org) throw new Error("run `pnpm db:seed` first");

    const name = `probe.pooled.${Date.now()}`;
    for (let index = 0; index < 20; index += 1) {
      await pooled.database.client.execute(sql`
        insert into outbox_event (id, organization_id, actor_id, name, payload, occurred_at)
        values (gen_random_uuid(), ${org.id}::uuid, gen_random_uuid(), ${name}, '{}'::jsonb, now())
      `);
    }

    try {
      const claimed: string[][] = [[], []];
      const drain = async (gateway: PgOutboxGateway, into: string[]) => {
        await gateway.drain(10, async (events) => {
          // Slow enough that both claims are open at once: a serial pair would be
          // disjoint whether `SKIP LOCKED` worked or not.
          await new Promise((resolve) => setTimeout(resolve, 300));
          into.push(...events.filter((event) => event.name === name).map((event) => event.id));
        });
      };

      await Promise.all([
        drain(
          new PgOutboxGateway(DatabaseCluster.single(pooled.database), pooled.scope, shards),
          claimed[0] as string[],
        ),
        drain(
          new PgOutboxGateway(DatabaseCluster.single(second.database), second.scope, shards),
          claimed[1] as string[],
        ),
      ]);

      const [a = [], b = []] = claimed;
      expect(a.filter((id) => b.includes(id))).toEqual([]);
      expect(a.length + b.length).toBeGreaterThan(0);
    } finally {
      await pooled.database.client.execute(sql`delete from outbox_event where name = ${name}`);
    }
  });
});

// The constraint is the transaction, not the pooler: this succeeds on either URL as a
// single statement, and fails on either inside `run`. See docs/infra/reference/pgbouncer.md.
describe("DETACH PARTITION CONCURRENTLY", () => {
  const scratch = async (handle: ReturnType<typeof open>, table: string) => {
    await handle.database.client.execute(sql.raw(`drop table if exists ${table} cascade`));
    await handle.database.client.execute(sql.raw(`drop table if exists ${table}_a cascade`));
    await handle.database.client.execute(
      sql.raw(
        `create table ${table} (id int, at timestamptz not null, primary key (id, at)) partition by range (at)`,
      ),
    );
    await handle.database.client.execute(
      sql.raw(
        `create table ${table}_a partition of ${table} for values from ('2020-01-01') to ('2020-02-01')`,
      ),
    );
  };

  it("succeeds as a single statement and fails inside a transaction", async () => {
    const table = `probe_detach_${Date.now()}`;

    try {
      await scratch(direct, table);
      await direct.database.client.execute(
        sql.raw(`alter table ${table} detach partition ${table}_a concurrently`),
      );

      await scratch(direct, table);
      // The cause, not the message: drizzle wraps every failure as `Failed query: …`, so
      // asserting on the outer text would pass for any error at all.
      const thrown = await direct.unitOfWork
        .run(async () => {
          await direct.scope
            .current()
            ?.client.execute(
              sql.raw(`alter table ${table} detach partition ${table}_a concurrently`),
            );
        })
        .then(
          () => null,
          (error: unknown) => error as Error,
        );

      expect((thrown?.cause as Error | undefined)?.message).toMatch(
        /cannot run inside a transaction block/,
      );
    } finally {
      await direct.database.client.execute(sql.raw(`drop table if exists ${table} cascade`));
      await direct.database.client.execute(sql.raw(`drop table if exists ${table}_a cascade`));
    }
  });
});
