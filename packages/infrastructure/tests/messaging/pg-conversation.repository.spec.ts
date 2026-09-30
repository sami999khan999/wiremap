import {
  type ConversationId,
  Identifiers,
  type OrganizationId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, type Logger, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgConversationRepository } from "../../src/pg/repository/pg-conversation.repository.js";
import { organizations, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedTenant } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// Routed repositories refuse to pick a pool with no shard in scope, which is the
// tripwire working. One node here, so entering it is the whole placement.
const placeOnTheOneNode = () => shards.enter({ key: "spec" as never, node: 0 });

// Both hooks, and registered first: vitest runs every `beforeAll` before any
// `beforeEach`, and a fixture built in one of those makes routed queries too.
beforeAll(placeOnTheOneNode);
beforeEach(placeOnTheOneNode);

// What the fixed-query-count claims are measured with. Drizzle calls this once per
// statement it issues, which is the only place a second round trip shows up.
class CountingLogger implements Logger {
  public count = 0;
  public logQuery(): void {
    this.count += 1;
  }
}

const counter = new CountingLogger();
let database: Database;
let repository: PgConversationRepository;
let organizationId: OrganizationId;
let alice: UserId;
let bob: UserId;
let carol: UserId;
let dave: UserId;
const conversationIds: ConversationId[] = [];

const makeUser = async (name: string): Promise<UserId> => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client.insert(users).values({ id, name, email: `${id}@example.test` });
  return id;
};

beforeAll(async () => {
  database = openDatabase(counter);
  repository = new PgConversationRepository(
    DatabaseCluster.single(database),
    new TransactionScope(),
    shards,
  );

  // Its own tenant, never the seeded one: this spec counts statements, and a page whose
  // size depends on what another spec left behind cannot hold a count at all.
  organizationId = Identifiers.organizationId.parse(Uuid.v7());
  await database.client.insert(organizations).values({
    id: organizationId,
    name: "Messaging Spec",
    slug: `messaging-spec-${organizationId}`,
  });
  // Every table this spec writes to is partitioned by tenant, so the partitions come
  // before the first row the way they do on every path that founds an organization.
  await seedTenant(database, organizationId);

  alice = await makeUser("Alice");
  bob = await makeUser("Bob");
  carol = await makeUser("Carol");
  // In no conversation at all, which is the only case where the member lookup is skipped.
  dave = await makeUser("Dave");

  // Four conversations, alice in every one. Each is touched with a distinct instant, so
  // the keyset has a total order and a page boundary is a fact rather than a coin toss.
  for (let index = 0; index < 4; index += 1) {
    const id = await repository.save({
      organizationId,
      kind: index === 0 ? "direct" : "channel",
      title: index === 0 ? null : `Channel ${index}`,
      directKey: index === 0 ? `${alice}_${bob}` : null,
      createdBy: alice,
      memberIds: index === 3 ? [alice, bob, carol] : [alice, bob],
    });
    conversationIds.push(id);
    await repository.touch(
      organizationId,
      id,
      Identifiers.messageId.parse(Uuid.v7()),
      new Date(Date.UTC(2030, 0, index + 1)),
    );
  }
});

afterAll(async () => {
  // One delete. `messages`, `conversations` and `conversation_members` all cascade off
  // the tenant, which is the property `tenant-cascade.spec.ts` holds separately.
  await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  await database.client.delete(users).where(eq(users.id, alice));
  await database.client.delete(users).where(eq(users.id, bob));
  await database.client.delete(users).where(eq(users.id, carol));
  await database.client.delete(users).where(eq(users.id, dave));
  await database.close();
});

beforeEach(() => {
  counter.count = 0;
});

describe("PgConversationRepository.listByMember", () => {
  // The claim `C5.8` makes. A member lookup per row is the N+1 this shape exists to
  // avoid, and it only ever shows up against a page holding more than one row.
  it("is two statements for a page, whatever size the page is", async () => {
    const one = await repository.listByMember(organizationId, alice, { limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(counter.count).toBe(2);

    counter.count = 0;
    const four = await repository.listByMember(organizationId, alice, { limit: 10 });
    expect(four.items).toHaveLength(4);
    expect(counter.count).toBe(2);
  });

  // Not decoration: the count above is worth nothing if the second statement returned no
  // members, and an empty page would spend one statement rather than two either way.
  it("carries every member of every row on the page", async () => {
    const page = await repository.listByMember(organizationId, alice, { limit: 10 });

    const sizes = page.items.map((item) => item.members.length).sort();
    expect(sizes).toEqual([2, 2, 2, 3]);
  });

  // `CR.26`. A page of twenty channels of five thousand was a hundred thousand member
  // rows; a row needs a name, so a channel brings a sample and the reader is always in it.
  it("brings a sample of a large channel, with the reader in it", async () => {
    const crowd: UserId[] = [];
    for (let index = 0; index < 8; index += 1) crowd.push(await makeUser(`Crowd ${index}`));
    // Made last, so the newest id among nine: a sample by id alone would leave them out.
    const reader = await makeUser("Reader");
    const id = await repository.save({
      organizationId,
      kind: "channel",
      title: "Crowded",
      directKey: null,
      createdBy: crowd[0] as UserId,
      memberIds: [...crowd, reader],
    });

    try {
      const page = await repository.listByMember(organizationId, reader, { limit: 10 });
      const members = page.items.find((item) => item.id === id)?.members ?? [];

      expect(members.length).toBeLessThanOrEqual(6);
      expect(members.length).toBeGreaterThan(1);
      expect(members.map((member) => member.userId)).toContain(reader);
      // The whole roster is still one call away, where it is needed.
      expect((await repository.findById(organizationId, id))?.members).toHaveLength(9);
    } finally {
      for (const user of [...crowd, reader])
        await database.client.delete(users).where(eq(users.id, user));
    }
  });

  it("spends one statement on a page with nothing on it", async () => {
    const page = await repository.listByMember(organizationId, dave, { limit: 10 });

    expect(page.items).toHaveLength(0);
    // One, not two: there are no ids to look members up for, and an `IN ()` would be a
    // round trip spent asking about nothing.
    expect(counter.count).toBe(1);
  });

  // The tenant scope and the membership join, in one case: carol is in exactly one.
  it("returns only the conversations the member is actually in", async () => {
    const page = await repository.listByMember(organizationId, carol, { limit: 10 });

    expect(page.items.map((item) => item.id)).toEqual([conversationIds[3]]);
  });

  // Newest first, and the cursor is what makes the second page the rest rather than the
  // same rows again — the failure a row-constructor keyset is written the way it is to avoid.
  it("pages backwards through the list without repeating or skipping a row", async () => {
    const first = await repository.listByMember(organizationId, alice, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();

    const second = await repository.listByMember(organizationId, alice, {
      limit: 2,
      cursor: first.nextCursor ?? "",
    });

    const walked = [...first.items, ...second.items].map((item) => item.id);
    expect(walked).toEqual([...conversationIds].reverse());
    expect(second.nextCursor).toBeNull();
  });
});

// `R.11`. Declared after the suite above on purpose: its fixture adds a fifth row, and
// vitest runs a nested `beforeAll` when that suite starts, not when the file loads.
describe("PgConversationRepository.listByMember — a conversation with no messages", () => {
  let quiet: ConversationId;

  beforeAll(async () => {
    // Never touched, so `last_message_at` stays null. Under `DESC` Postgres puts nulls
    // first, and the cursor was encoded from a column that had nothing in it.
    quiet = await repository.save({
      organizationId,
      kind: "channel",
      title: "Quiet",
      directKey: null,
      createdBy: alice,
      memberIds: [alice],
    });
  });

  it("hands back a cursor rather than truncating the list", async () => {
    const page = await repository.listByMember(organizationId, alice, { limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
  });

  it("walks every conversation, the quiet one included", async () => {
    const walked: ConversationId[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const result = await repository.listByMember(organizationId, alice, { limit: 2, cursor });
      walked.push(...result.items.map((item) => item.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(walked).toHaveLength(5);
    expect(walked).toContain(quiet);
    // Last, not first: `created_at` is today and every other row was touched into 2030.
    expect(walked.at(-1)).toBe(quiet);
  });
});

describe("PgConversationRepository.findMembership", () => {
  // One statement, and no member rows: the check every send and every page open makes.
  it("answers a member with the header, in one statement", async () => {
    const id = conversationIds[3] as ConversationId;

    const header = await repository.findMembership(organizationId, id, carol);

    expect(header).toMatchObject({ id, kind: "channel" });
    expect(header).not.toHaveProperty("members");
    expect(counter.count).toBe(1);
  });

  it("answers null to somebody who is not in the room", async () => {
    const id = conversationIds[0] as ConversationId;

    await expect(repository.findMembership(organizationId, id, carol)).resolves.toBeNull();
  });
});

describe("PgConversationRepository.touch", () => {
  // Two sends committing out of order: the older one must not become the latest.
  it("never moves the latest message backwards", async () => {
    const id = conversationIds[1] as ConversationId;
    const before = await repository.findById(organizationId, id);

    await repository.touch(
      organizationId,
      id,
      Identifiers.messageId.parse(Uuid.v7()),
      new Date(Date.UTC(2020, 0, 1)),
    );

    const after = await repository.findById(organizationId, id);
    expect(after?.lastMessageAt).toEqual(before?.lastMessageAt);
    expect(after?.lastMessageId).toEqual(before?.lastMessageId);
  });
});

// `CR.31`. `KeysetCursor` encodes milliseconds, and a microsecond sort key made a page
// ending on a message-less conversation skip the rows in the truncated window.
describe("conversations.created_at", () => {
  it("is stored to the millisecond, the precision the cursor carries", async () => {
    const found = await database.client.execute<{ precision: number }>(sql`
      select datetime_precision as precision from information_schema.columns
      where table_name = 'conversations' and column_name = 'created_at'
      limit 1
    `);

    expect(Number(found.rows[0]?.precision)).toBe(3);
  });
});
