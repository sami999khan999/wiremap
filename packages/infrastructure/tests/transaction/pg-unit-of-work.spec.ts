import {
  Principal,
  Shard,
  type ShardKey,
  type ShardPlacement,
  ShardResolver,
} from "@loadbearing/application";
import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet } from "@loadbearing/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database, DatabaseCluster, type DrizzleClient } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { activityLog } from "../../src/pg/schema/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { DATABASE_URL, openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let scope: TransactionScope;

beforeAll(() => {
  database = openDatabase();
  scope = new TransactionScope();
});

afterAll(async () => {
  await database.close();
});

const actorFor = async () =>
  new Principal(
    await seedOrganizationId(database),
    Identifiers.userId.parse(Uuid.v7()),
    CapabilitySet.empty(),
  );

const findByAction = (action: string) =>
  database.client
    .select({ action: activityLog.action })
    .from(activityLog)
    .where(eq(activityLog.action, action));

describe("PgUnitOfWork", () => {
  it("rolls back every write in the callback", async () => {
    const actor = await actorFor();
    const uow = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");
    const logger = new PgActivityLogger(
      DatabaseCluster.single(database),
      scope,
      shards,
      new SystemClock(),
    );
    const action = `test.rollback.${Uuid.v7()}`;

    await expect(
      uow.run(async () => {
        await logger.record(actor, action, { probe: true });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await findByAction(action)).toEqual([]);
  });

  // The regression guard for a nested `run()` opening a second connection: the inner unit
  // committed on a connection the outer one could not roll back.
  it("joins the outer transaction rather than opening a second one", async () => {
    const actor = await actorFor();
    const uow = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");
    const logger = new PgActivityLogger(
      DatabaseCluster.single(database),
      scope,
      shards,
      new SystemClock(),
    );
    const outer = `test.outer.${Uuid.v7()}`;
    const inner = `test.inner.${Uuid.v7()}`;

    await expect(
      uow.run(async () => {
        await logger.record(actor, outer, { probe: true });

        await uow.run(async () => {
          await logger.record(actor, inner, { probe: true });
        });

        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Both, or the inner write survived a rollback it was supposed to be part of.
    expect(await findByAction(outer)).toEqual([]);
    expect(await findByAction(inner)).toEqual([]);
  });

  // The savepoint has to be a savepoint rather than a no-op: an inner failure caught by
  // the outer callback rolls back only the inner work.
  it("rolls the inner work back to a savepoint without losing the outer", async () => {
    const actor = await actorFor();
    const uow = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");
    const logger = new PgActivityLogger(
      DatabaseCluster.single(database),
      scope,
      shards,
      new SystemClock(),
    );
    const outer = `test.kept.${Uuid.v7()}`;
    const inner = `test.dropped.${Uuid.v7()}`;

    await uow.run(async () => {
      await logger.record(actor, outer, { probe: true });

      await expect(
        uow.run(async () => {
          await logger.record(actor, inner, { probe: true });
          throw new Error("inner");
        }),
      ).rejects.toThrow("inner");
    });

    expect(await findByAction(outer)).toHaveLength(1);
    expect(await findByAction(inner)).toEqual([]);
  });

  // A run() that rolled back on success too would pass the assertion above
  // perfectly, which is why both directions are asserted.
  it("commits when the callback returns", async () => {
    const actor = await actorFor();
    const uow = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");
    const logger = new PgActivityLogger(
      DatabaseCluster.single(database),
      scope,
      shards,
      new SystemClock(),
    );
    const action = `test.commit.${Uuid.v7()}`;

    await uow.run(async () => {
      await logger.record(actor, action, { probe: true });
    });

    expect(await findByAction(action)).toHaveLength(1);
  });

  // Two distinct values, neither of them the 30s default, so a `SET LOCAL` that never ran
  // and one that ran and leaked both fail. See docs/reference/unit-of-work.md.
  it("applies the configured statement timeout inside run and nowhere else", async () => {
    const pooled = new Database({ url: DATABASE_URL, statementTimeoutMs: 25_000 });
    const timeoutScope = new TransactionScope();
    const uow = new PgUnitOfWork(DatabaseCluster.single(pooled), timeoutScope, shards, "catalog", {
      statementTimeoutMs: 90_000,
    });

    const show = async (client: DrizzleClient) =>
      (await client.execute<{ statement_timeout: string }>(sql`show statement_timeout`)).rows[0]
        ?.statement_timeout;

    try {
      expect(await show(pooled.client)).toBe("25s");

      await uow.run(async () => {
        const open = timeoutScope.current();
        if (!open) throw new Error("no transaction in scope");
        expect(await show(open.client)).toBe("90s");
      });

      // The connection went back to the pool with the transaction; a plain `SET` here
      // would have followed it and become every later caller's timeout.
      expect(await show(pooled.client)).toBe("25s");
    } finally {
      await pooled.close();
    }
  });

  // Without the guard this sets the timeout on the savepoint's own `SET LOCAL`, which
  // outlives a rollback to that savepoint and silently raises the outer transaction's.
  it("leaves a nested run to the transaction already open", async () => {
    const pooled = new Database({ url: DATABASE_URL, statementTimeoutMs: 25_000 });
    const timeoutScope = new TransactionScope();
    const uow = new PgUnitOfWork(DatabaseCluster.single(pooled), timeoutScope, shards, "catalog", {
      statementTimeoutMs: 90_000,
    });

    try {
      await uow.run(async () => {
        await uow.run(async () => {
          const open = timeoutScope.current();
          if (!open) throw new Error("no transaction in scope");
          expect(
            (await open.client.execute<{ statement_timeout: string }>(sql`show statement_timeout`))
              .rows[0]?.statement_timeout,
          ).toBe("90s");
        });
      });
    } finally {
      await pooled.close();
    }
  });
});

// The directory as a move changes it: the answer is whatever the spec last set, and
// every read is counted, because the recheck's cost is one resolve per transaction.
class MovingResolver extends ShardResolver {
  public answer: ShardPlacement = { node: 0, frozen: false };
  public reads = 0;

  public override placementOf(_key: ShardKey): Promise<ShardPlacement> {
    this.reads += 1;
    return Promise.resolve(this.answer);
  }

  public override resolve(key: ShardKey): Promise<number> {
    return this.placementOf(key).then((placement) => placement.node);
  }

  public override invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

// `24.2b`: a job placed before a freeze and still opening transactions after the settle.
describe("PgUnitOfWork recheck", () => {
  const key = Shard.keyOf(Uuid.v7() as OrganizationId);

  const build = (placement: "routed" | "local" | "catalog" = "routed") => {
    const resolver = new MovingResolver();
    const cluster = DatabaseCluster.of([{ pooled: database, direct: database }], resolver);
    const jobShards = new ShardScope();
    const uow = new PgUnitOfWork(cluster, new TransactionScope(), jobShards, placement);
    const asJob = <T>(work: () => Promise<T>, recheck = true) =>
      jobShards.within({ key, node: 0, frozen: false, recheck }, work);
    return { resolver, uow, asJob };
  };

  const inFlight = (error: unknown) =>
    error instanceof ForbiddenError && error.context.permission === "shard.move.inFlight";

  it("refuses a job's next transaction once the tenant is frozen", async () => {
    const { resolver, uow, asJob } = build();
    let ran = false;

    await asJob(async () => {
      await uow.run(async () => {
        ran = true;
      });
      resolver.answer = { node: 0, frozen: true };

      const refused = await uow.run(async () => "wrote").catch((error: unknown) => error);
      expect(inFlight(refused)).toBe(true);
    });

    expect(ran).toBe(true);
  });

  // The flip happened between two transactions: the rows the job would write now live
  // on node 1, and a write to node 0 is one the reclaim drops.
  it("refuses a job whose tenant moved to another node", async () => {
    const { resolver, uow, asJob } = build("local");
    resolver.answer = { node: 1, frozen: false };

    const refused = await asJob(() => uow.run(async () => "wrote")).catch((error) => error);
    expect(inFlight(refused)).toBe(true);
  });

  it("costs one resolve per transaction and none per savepoint", async () => {
    const { resolver, uow, asJob } = build();

    await asJob(async () => {
      await uow.run(async () => {
        await uow.run(async () => undefined);
        await uow.run(async () => undefined);
      });
      await uow.run(async () => undefined);
    });

    expect(resolver.reads).toBe(2);
  });

  // A request places itself once and the settle covers it; a catalog row is never
  // copied by a move. Neither asks, so neither pays the resolve.
  it("leaves a request and a catalog transaction unchecked", async () => {
    const request = build();
    request.resolver.answer = { node: 0, frozen: true };
    expect(await request.asJob(() => request.uow.run(async () => "wrote"), false)).toBe("wrote");
    expect(request.resolver.reads).toBe(0);

    const catalog = build("catalog");
    catalog.resolver.answer = { node: 0, frozen: true };
    expect(await catalog.asJob(() => catalog.uow.run(async () => "wrote"))).toBe("wrote");
    expect(catalog.resolver.reads).toBe(0);
  });
});
