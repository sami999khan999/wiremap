import { Shard } from "@loadbearing/application";
import type { DocSpaceId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgDocSpaceRepository, PgTenantRepository } from "../../src/pg/repository/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

// The tripwire this phase exists for, and it has to be asserted on one node: on one node
// these all succeed by accident, and the day there are two they are silent corruption.

const database = openDatabase();
const cluster = DatabaseCluster.single(database);
const scope = new TransactionScope();
const shards = new ShardScope();

const catalogWork = new PgUnitOfWork(cluster, scope, shards, "catalog");
const routedWork = new PgUnitOfWork(cluster, scope, shards, "routed");

const tenants = new PgTenantRepository(cluster, scope, shards);
const spaces = new PgDocSpaceRepository(cluster, scope, shards);
const nothing = Uuid.v7() as DocSpaceId;

afterAll(async () => {
  await database.close();
});

// `Error.message` on an `InternalError` **is** the code — `INTERNAL` — and the sentence
// is on its cause. See docs/ai/rules/vocabulary.md.
const refusal = async (work: Promise<unknown>): Promise<string> => {
  const thrown = await work.then(
    () => null,
    (error: unknown) => error,
  );

  expect(thrown, "expected a refusal, got a result").toBeInstanceOf(Error);
  const cause = (thrown as Error).cause;

  return cause instanceof Error ? cause.message : String(cause);
};

describe("a routed query with no shard in scope", () => {
  it("throws rather than reading node 0", async () => {
    const organizationId = await seedOrganizationId(database);

    const why = await refusal(spaces.findById(organizationId, nothing));
    expect(why).toMatch(/no shard in scope/i);
  });

  it("throws from `run` too, before the transaction is opened", async () => {
    expect(await refusal(routedWork.run(async () => undefined))).toMatch(/no shard in scope/i);
  });
});

describe("the placement tripwire", () => {
  // A catalog repository used inside a routed transaction reads the wrong database the
  // day the split happens. `local` is compatible with both, which is what it means.
  it("refuses a catalog read inside a routed transaction", async () => {
    const organizationId = await seedOrganizationId(database);

    const crossing = shards.within({ key: Shard.keyOf(organizationId), node: 0 }, () =>
      routedWork.run(() => tenants.findBy(organizationId)),
    );

    expect(await refusal(crossing)).toMatch(/catalog table inside a routed transaction/i);
  });

  it("refuses a routed transaction nested inside a catalog one", async () => {
    const organizationId = await seedOrganizationId(database);

    const nested = shards.within({ key: Shard.keyOf(organizationId), node: 0 }, () =>
      catalogWork.run(() => routedWork.run(async () => undefined)),
    );

    expect(await refusal(nested)).toMatch(/routed transaction inside a catalog one/i);
  });

  it("lets the same placement through, which is the case that has to keep working", async () => {
    const organizationId = await seedOrganizationId(database);

    const allowed = shards.within({ key: Shard.keyOf(organizationId), node: 0 }, () =>
      routedWork.run(() => spaces.findById(organizationId, nothing)),
    );

    await expect(allowed).resolves.toBeNull();
  });
});
