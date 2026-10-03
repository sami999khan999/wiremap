import {
  Identifiers,
  type OrganizationId,
  type UserId,
  type WebhookId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgWebhookRepository } from "../../src/pg/repository/pg-webhook.repository.js";
import { organizations, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();
let database: Database;
let cluster: DatabaseCluster;
let acme: OrganizationId;
let owner: UserId;
const repository = () => new PgWebhookRepository(cluster, new TransactionScope(), shards);

const save = async (failureFree = true) => {
  const id = Uuid.v7() as WebhookId;
  await repository().save(acme, {
    id,
    projectId: null,
    kind: "generic",
    encryptedUrl: "v1:url",
    urlHint: "h.test/…abcd",
    encryptedSecret: failureFree ? "v1:secret" : null,
    events: ["scan.failed"],
  });
  return id;
};

beforeAll(async () => {
  shards.enter({ key: "spec" as never, node: 0 });
  database = openDatabase();
  cluster = DatabaseCluster.single(database);
  owner = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: owner, name: "Owner", email: `${owner}@example.test`, emailVerified: true });
  // No audit rows: they would reach the outbox, and `pg-outbox.spec.ts` drains it whole.
  const activity = { record: () => Promise.resolve() } as never;
  acme = await new PgOrganizationFounder(
    cluster,
    new TransactionScope(),
    shards,
    activity,
    new RecordingLogger(),
  ).found(owner, "Acme");
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, acme));
  await database.client.delete(users).where(inArray(users.id, [owner]));
  await database.close();
});

describe("PgWebhookRepository", () => {
  it("saves, lists and changes a webhook's events", async () => {
    const id = await save();
    await repository().setEvents(acme, id, ["scan.succeeded", "finding.created"]);

    const found = await repository().findById(acme, id);
    expect(found).toMatchObject({ kind: "generic", failureCount: 0, disabledAt: null });
    expect(found?.events).toEqual(["scan.succeeded", "finding.created"]);
    expect((await repository().list(acme)).map((webhook) => webhook.id)).toContain(id);
  });

  // One statement per delivery: the count and the switch-off cannot disagree.
  it("counts failures in a row, resets on success, and switches off at the limit", async () => {
    const id = await save(false);
    const at = new Date();
    const fail = () =>
      repository().recordDelivery(acme, id, { ok: false, status: 500, at, disableAfter: 3 });

    expect(await fail()).toEqual({ failureCount: 1, disabled: false });
    expect(
      await repository().recordDelivery(acme, id, { ok: true, status: 200, at, disableAfter: 3 }),
    ).toEqual({ failureCount: 0, disabled: false });
    await fail();
    await fail();
    expect(await fail()).toEqual({ failureCount: 3, disabled: true });
    expect((await repository().findById(acme, id))?.lastStatus).toBe(500);

    await repository().setEnabled(acme, id, true, at);
    expect(await repository().findById(acme, id)).toMatchObject({
      disabledAt: null,
      failureCount: 0,
    });
  });

  it("deletes a webhook", async () => {
    const id = await save();
    await repository().delete(acme, id);
    expect(await repository().findById(acme, id)).toBeNull();
  });
});
