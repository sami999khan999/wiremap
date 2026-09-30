import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgWidgetPreferenceRepository } from "../../src/pg/repository/pg-widget-preference.repository.js";
import { widgetPreferences } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();
const placeOnTheOneNode = () => shards.enter({ key: "spec" as never, node: 0 });

beforeAll(placeOnTheOneNode);
beforeEach(placeOnTheOneNode);

let database: Database;
let organizationId: OrganizationId;
// Fresh ids per run: the table names no user by foreign key, so none has to exist.
const ada = Identifiers.userId.parse(Uuid.v7());
const grace = Identifiers.userId.parse(Uuid.v7());
// The org default row is shared by the whole tenant, so the spec's own widget name keeps
// it apart from anything a person set by hand.
const CARD = `spec.card.${Uuid.v7()}`;

const repository = () =>
  new PgWidgetPreferenceRepository(
    DatabaseCluster.single(database),
    new TransactionScope(),
    shards,
  );

beforeAll(async () => {
  database = openDatabase();
  organizationId = await seedOrganizationId(database);
});

afterAll(async () => {
  await database.client.delete(widgetPreferences).where(eq(widgetPreferences.widget, CARD));
  await database.close();
});

describe("PgWidgetPreferenceRepository", () => {
  it("hides a card for one person and nobody else", async () => {
    await repository().save(organizationId, ada, CARD);

    expect((await repository().findFor(organizationId, ada)).hiddenByUser).toContain(CARD);
    expect((await repository().findFor(organizationId, grace)).hiddenByUser).not.toContain(CARD);
  });

  // The second partial index. One unique index over a nullable `user_id` would have taken
  // both of these, because NULLs are distinct.
  it("keeps one row for a repeated hide, the org default included", async () => {
    await repository().save(organizationId, ada, CARD);
    await repository().save(organizationId, null, CARD);
    await repository().save(organizationId, null, CARD);

    const rows = await database.client
      .select({ userId: widgetPreferences.userId })
      .from(widgetPreferences)
      .where(eq(widgetPreferences.widget, CARD));
    expect(rows.filter((row) => row.userId === null)).toHaveLength(1);
    expect(rows.filter((row) => row.userId === ada)).toHaveLength(1);
  });

  it("reads the org default as the admin's hide, for every member", async () => {
    for (const userId of [ada, grace]) {
      expect((await repository().findFor(organizationId, userId)).hiddenByAdmin).toContain(CARD);
    }
  });

  it("restores the person's own without touching the org default, and the other way round", async () => {
    await repository().delete(organizationId, ada, CARD);
    let seen = await repository().findFor(organizationId, ada);
    expect(seen.hiddenByUser).not.toContain(CARD);
    expect(seen.hiddenByAdmin).toContain(CARD);

    await repository().delete(organizationId, null, CARD);
    seen = await repository().findFor(organizationId, ada);
    expect(seen.hiddenByAdmin).not.toContain(CARD);
  });
});
