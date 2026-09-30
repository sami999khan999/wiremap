import {
  type ConversationId,
  Identifiers,
  type MessageId,
  type OrganizationId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgConversationRepository } from "../../src/pg/repository/pg-conversation.repository.js";
import { PgMessageRepository } from "../../src/pg/repository/pg-message.repository.js";
import { messages, organizations, users } from "../../src/pg/schema/index.js";
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

class CountingLogger implements Logger {
  public count = 0;
  public logQuery(): void {
    this.count += 1;
  }
}

// The cap `PgMessageRepository` counts to, and one message more than it — so the bound is
// measured at the boundary rather than somewhere comfortably inside it.
const UNREAD_CAP = 100;
const OVER_CAP = UNREAD_CAP + 1;

const counter = new CountingLogger();
let database: Database;
let repository: PgMessageRepository;
let conversations: PgConversationRepository;
let organizationId: OrganizationId;
let reader: UserId;
let author: UserId;
let quiet: ConversationId;
let loud: ConversationId;

const makeUser = async (name: string): Promise<UserId> => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client.insert(users).values({ id, name, email: `${id}@example.test` });
  return id;
};

// The id and the instant come from the caller since `0023`: `save` is a plain insert,
// and the send dedupe that used to live on a unique index here holds both in Redis.
const send = (conversationId: ConversationId, from: UserId, body: string) =>
  repository.save({
    id: Uuid.v7() as MessageId,
    createdAt: new Date(),
    organizationId,
    conversationId,
    authorId: from,
    clientId: Uuid.v7(),
    body,
  });

beforeAll(async () => {
  database = openDatabase(counter);
  const scope = new TransactionScope();
  repository = new PgMessageRepository(DatabaseCluster.single(database), scope, shards);
  conversations = new PgConversationRepository(DatabaseCluster.single(database), scope, shards);

  organizationId = Identifiers.organizationId.parse(Uuid.v7());
  await database.client
    .insert(organizations)
    .values({ id: organizationId, name: "Message Spec", slug: `message-spec-${organizationId}` });
  await seedTenant(database, organizationId);

  reader = await makeUser("Reader");
  author = await makeUser("Author");

  const members = { createdBy: reader, memberIds: [reader, author] as const };
  quiet = await conversations.save({
    organizationId,
    kind: "channel",
    title: "Quiet",
    directKey: null,
    ...members,
    memberIds: [...members.memberIds],
  });
  loud = await conversations.save({
    organizationId,
    kind: "channel",
    title: "Loud",
    directKey: null,
    ...members,
    memberIds: [...members.memberIds],
  });

  // Five in the quiet one, sent one statement at a time so `created_at` separates them:
  // `now()` is the transaction's instant, and a bulk insert would give all five the same.
  for (let index = 0; index < 5; index += 1) {
    await send(quiet, index % 2 === 0 ? author : reader, `line ${index}`);
  }

  // The loud one is bulk-inserted, because the cap case needs a hundred and one rows and
  // what it asserts is a count, not an order.
  await database.client.insert(messages).values(
    Array.from({ length: OVER_CAP }, (_, index) => ({
      id: Uuid.v7() as MessageId,
      organizationId,
      conversationId: loud,
      authorId: author,
      clientId: Uuid.v7(),
      body: `bulk ${index}`,
    })),
  );
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  await database.client.delete(users).where(eq(users.id, reader));
  await database.client.delete(users).where(eq(users.id, author));
  await database.close();
});

beforeEach(() => {
  counter.count = 0;
});

describe("PgMessageRepository.list", () => {
  // The claim `C5.8` makes: one statement for a page of messages, at any size and on any
  // page. The limit+1 probe for `olderCursor` is the same statement, not a second one.
  it("is one statement for a page, first page or not", async () => {
    const first = await repository.list(organizationId, { conversationId: quiet, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(counter.count).toBe(1);

    counter.count = 0;
    const older = await repository.list(organizationId, {
      conversationId: quiet,
      limit: 2,
      before: first.olderCursor ?? "",
    });
    expect(older.items).toHaveLength(2);
    expect(counter.count).toBe(1);
  });

  it("pages backwards from the newest without repeating or skipping a row", async () => {
    const bodies: string[] = [];
    let before: string | undefined;

    for (let page = 0; page < 3; page += 1) {
      const result = await repository.list(organizationId, {
        conversationId: quiet,
        limit: 2,
        ...(before ? { before } : {}),
      });
      bodies.push(...result.items.map((item) => item.body));
      if (!result.olderCursor) break;
      before = result.olderCursor;
    }

    expect(bodies).toEqual(["line 4", "line 3", "line 2", "line 1", "line 0"]);
  });
});

// `created_at` is carried back by every one of these as a predicate, so the value the
// caller holds has to be the value stored — see application/docs/reference/messaging.md.
describe("PgMessageRepository — the timestamp a caller carries back", () => {
  it("finds, edits and deletes a message by the instant it was handed", async () => {
    const sent = await send(quiet, author, "round trip");

    expect(
      await repository.findById(organizationId, quiet, sent.id, sent.createdAt),
    ).not.toBeNull();

    const edited = await repository.edit(
      organizationId,
      sent.id,
      sent.createdAt,
      "round trip, edited",
      new Date(),
    );
    expect(edited?.body).toBe("round trip, edited");

    await repository.softDelete(organizationId, sent.id, sent.createdAt, new Date());
    const gone = await repository.findById(organizationId, quiet, sent.id, sent.createdAt);
    expect(gone?.deleted).toBe(true);
  });
});

describe("PgMessageRepository.unreadCounts", () => {
  // One statement for the whole page of conversations, which is what the LATERAL is for:
  // a count per conversation would be one round trip per row on the busiest screen here.
  it("is one statement however many conversations it is asked about", async () => {
    const both = await repository.unreadCounts(organizationId, reader, [quiet, loud]);

    expect(both).toHaveLength(2);
    expect(counter.count).toBe(1);
  });

  it("spends no statement at all on an empty list", async () => {
    expect(await repository.unreadCounts(organizationId, reader, [])).toEqual([]);
    expect(counter.count).toBe(0);
  });

  // The count is what the reader has not seen, so their own messages are not in it and
  // neither is anything before the mark. Without this the statement count proves nothing.
  it("counts what the reader has not read, and never their own messages", async () => {
    const page = await repository.list(organizationId, { conversationId: quiet, limit: 10 });
    const unread = await repository.unreadCounts(organizationId, reader, [quiet]);

    // Three of the five are the author's: lines 0, 2 and 4.
    expect(unread[0]?.count).toBe(3);

    const third = page.items[2];
    if (!third) throw new Error("the quiet conversation lost its messages");
    await conversations.markRead(organizationId, quiet, reader, third.id, third.createdAt);

    const after = await repository.unreadCounts(organizationId, reader, [quiet]);
    expect(after[0]?.count).toBe(1);
  });

  // Bounded, not merely large. A stale channel must cost a hundred index entries rather
  // than a full count of everything in it.
  it("stops counting at the cap rather than returning the true total", async () => {
    const unread = await repository.unreadCounts(organizationId, reader, [loud]);

    expect(unread[0]?.count).toBe(UNREAD_CAP);
  });

  it("leaves a deleted message out of the count", async () => {
    const sent = await send(quiet, author, "retracted");
    expect((await repository.unreadCounts(organizationId, reader, [quiet]))[0]?.count).toBe(2);

    await repository.softDelete(organizationId, sent.id, sent.createdAt, new Date());

    expect((await repository.unreadCounts(organizationId, reader, [quiet]))[0]?.count).toBe(1);
  });
});
