import { Shard } from "@loadbearing/application";
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  asc,
  eq,
  Identifiers,
  type NewNotification,
  type OrganizationId,
  RealtimeChannels,
  sql,
  type UserId,
  Uuid,
} from "../../src/import.js";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import {
  PgMaintenanceGateway,
  PgNotificationRecipientReader,
  PgNotificationRepository,
} from "../../src/pg/repository/index.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { SystemRoleSeed, TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { RedisConnection, RedisRealtimePublisher } from "../../src/redis/index.js";
import type {} from "./support/stack.js";

// The three patterns `docs/opinions/data-and-scale.md` §6 says fail before the database
// does. This measures each one on its own, against the running stack.

const stack = inject("stack");

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();
const scope = new TransactionScope();

// Pooled for the reads and writes under test — that is the connection the application
// uses. The direct one is for the DDL a transaction pooler cannot carry.
const database = new Database({ url: stack.database.url });
const direct = new Database({ url: stack.database.directUrl });
const cluster = DatabaseCluster.single(database, direct);

const notifications = new PgNotificationRepository(cluster, scope, shards);
// The recipient reader is built on `countedCluster` below: the measurement is statement
// counts, so an uncounted reader measures nothing.
const maintenance = new PgMaintenanceGateway(
  DatabaseCluster.single(direct),
  scope,
  shards,
  new PgUnitOfWork(DatabaseCluster.single(direct), scope, shards, "catalog"),
);

const redis = new RedisConnection(stack.redis);
const publisher = new RedisRealtimePublisher(redis.client());

// The slug every synthetic tenant carries, so cleanup can find them without holding a
// list — a run killed half way through leaves them findable.
const SLUG = "fan-out-";

// The digest's own page size, from `SendNotificationDigestUseCase`. Measured rather than
// assumed: the number of round trips is the whole question at 25 000 recipients.
const DIGEST_PAGE = 200;

// `PgNotificationRepository` writes in chunks of this many. One statement per chunk is
// the claim; the reading below is what says whether it holds.
const WRITE_CHUNK = 1_000;

// How many frames go out together in the chunked reading below. Bounded rather than
// `Promise.all` over every member: a tenant of a hundred thousand is not a write buffer.
const PUBLISH_CHUNK = 500;

const created: OrganizationId[] = [];

interface Reading {
  readonly recipients: number;
  // §6 "Notification write amplification": one change, N rows, in chunks of 1 000.
  readonly writeMs: number;
  readonly writeStatements: number;
  readonly rowsWritten: number;
  // The same records again. At-least-once delivery means this is the common case, not
  // the exceptional one, so its cost is part of the path.
  readonly replayMs: number;
  readonly rowsOnReplay: number;
  // §6 "Digest fan-out": keyset pages of 200, one address-and-locale query per page.
  readonly digestMs: number;
  readonly digestPages: number;
  readonly digestStatements: number;
  // The realtime fan-out: one frame per member, each on that member's own channel.
  readonly publishMs: number;
  readonly perPublishUs: number;
  // The same frames in chunks. The difference between the two is the whole finding.
  readonly chunkedMs: number;
  readonly perChunkedUs: number;
}

const readings: Reading[] = [];

const timed = async <T>(work: () => Promise<T>): Promise<[T, number]> => {
  const started = performance.now();
  const value = await work();
  return [value, Math.round(performance.now() - started)];
};

// Counted off `pg_stat_statements`-free ground: drizzle's logger is what the other
// measurements in this suite use, and it counts what was actually issued.
class StatementCounter {
  public count = 0;

  public logQuery(): void {
    this.count += 1;
  }
}

const counter = new StatementCounter();
const counted = new Database({ url: stack.database.url, logger: counter });
const countedCluster = DatabaseCluster.single(counted, direct);
const countedNotifications = new PgNotificationRepository(countedCluster, scope, shards);
const countedRecipients = new PgNotificationRecipientReader(countedCluster, scope, shards);

// Deterministic, and **never deleted**: the next run finds the same people already there.
// See docs/reference/fan-out.md.
const personId = (index: number): UserId =>
  Identifiers.userId.parse(
    `018f8c00-fa00-7000-8000-${index.toString(16).padStart(12, "0")}`,
  ) as UserId;

// A tenant with `size` members, built the way the founder builds one: the organization,
// its system roles, its partitions, then the memberships.
const tenantOf = async (size: number): Promise<{ id: OrganizationId; members: UserId[] }> => {
  const id = Identifiers.organizationId.parse(Uuid.v7()) as OrganizationId;

  await direct.client.insert(organizations).values({ id, slug: `${SLUG}${id}`, name: "Fan-out" });
  await new TenantPartitionSeed(DatabaseCluster.single(direct), scope, shards).run(id);
  await new SystemRoleSeed(DatabaseCluster.single(direct), scope, shards).run(id);

  const [role] = await direct.client
    .select({ id: roles.id })
    .from(roles)
    .where(sql`${roles.organizationId} = ${id} and ${roles.key} = 'member'`);
  if (!role) throw new Error("SystemRoleSeed did not seed a member role");

  created.push(id);

  const members: UserId[] = [];
  // A thousand at a time. One statement per person is the shape this whole file exists
  // to measure, and paying it in the fixture would dominate the numbers.
  for (let written = 0; written < size; written += WRITE_CHUNK) {
    const batch = Array.from({ length: Math.min(WRITE_CHUNK, size - written) }, (_, offset) => {
      const userId = personId(written + offset);
      members.push(userId);
      return {
        id: userId,
        name: `Fan-out ${written + offset}`,
        email: `${written + offset}@fan-out.test`,
        locale: "en",
      };
    });

    // `onConflictDoNothing`, because the second run finds them all already there.
    await direct.client.insert(users).values(batch).onConflictDoNothing();
    await direct.client
      .insert(memberships)
      .values(
        batch.map((person) => ({
          id: Uuid.v7(),
          organizationId: id,
          userId: person.id,
          roleId: role.id,
        })),
      )
      .onConflictDoNothing();
  }

  return { id, members };
};

const notificationsFor = (
  organizationId: OrganizationId,
  members: readonly UserId[],
  eventId: string,
  at: Date,
): readonly NewNotification[] =>
  members.map((userId) => ({
    organizationId,
    userId,
    eventId,
    kind: "member.joined" as const,
    category: "membership" as const,
    params: { organization: "Fan-out" },
    link: null,
    subjectId: null,
    createdAt: at,
  }));

// Every page the digest would read, the way it reads them: keyset on `user_id`, no
// offset, one query per page.
const digestScan = async (
  reader: PgNotificationRecipientReader,
  organizationId: OrganizationId,
): Promise<number> => {
  let after: UserId | null = null;
  let pages = 0;

  for (;;) {
    const page = await reader.organizationMembers(organizationId, null, DIGEST_PAGE, after);
    pages += 1;
    if (page.length < DIGEST_PAGE) break;

    after = page[page.length - 1]?.userId ?? null;
    if (!after) break;
  }

  return pages;
};

afterAll(
  async () => {
    // Printed before the cleanup, never after: a run whose numbers died with its teardown
    // measured nothing.
    if (readings.length > 0) console.table(readings);

    for (;;) {
      const page = await direct.client
        .select({ id: organizations.id })
        .from(organizations)
        .where(sql`${organizations.slug} like ${`${SLUG}%`}`)
        .orderBy(asc(organizations.id))
        .limit(50);

      if (page.length === 0) break;

      for (const { id } of page) {
        // The partitions first: they hold this run's notification rows, and dropping the
        // table is what removes them without a delete per row.
        await maintenance.dropTenantPartitions(id);
        // One statement: `roles` and `memberships` go with the organization by cascade, and
        // deleting a role first is rejected by the membership pointing at it. Not the people.

        await direct.client.delete(organizations).where(eq(organizations.id, id));
      }
    }

    await redis.close();
    await counted.close();
    await database.close();
    await direct.close();
  },
  30 * 60 * 1_000,
);

// `skipIf`, not a bare `if`: a suite that silently contains no tests is indistinguishable
// from one that ran and found nothing.
describe.skipIf(!stack.fanOut)("the three fan-out paths", () => {
  for (const size of stack.fanOut ?? []) {
    it(
      `measures a tenant of ${size} recipients`,
      async () => {
        const { id, members } = await tenantOf(size);
        const at = new Date();

        // The compact "something changed" frame a member's own channel gets. Not the row:
        // the client refetches its inbox on it.
        const frame = () =>
          ({
            kind: "event",
            id: Uuid.v7(),
            name: "notification.created",
            at,
            payload: { kind: "member.joined" },
          }) as const;
        // A uuid, because `event_id` is one: the column is the outbox event this delivery
        // came from, and the dedupe index is on it.
        const records = notificationsFor(id, members, Uuid.v7(), at);

        // Placed, because `notifications` is routed: the node is resolved once, out here,
        // which is what lets `BaseRepository.db` stay a synchronous property read.
        const placed = { key: Shard.keyOf(id), node: 0 };

        counter.count = 0;
        const [written, writeMs] = await timed(() =>
          shards.within(placed, () => countedNotifications.saveMany(records)),
        );
        const writeStatements = counter.count;

        // The same event again, which is what at-least-once delivery produces. The dedupe
        // index is what makes this write nothing, and it still costs a statement per chunk.
        const [replayed, replayMs] = await timed(() =>
          shards.within(placed, () => notifications.saveMany(records)),
        );

        counter.count = 0;
        const [digestPages, digestMs] = await timed(() => digestScan(countedRecipients, id));
        const digestStatements = counter.count;

        // One frame per member, each on that member's own channel, one at a time.
        const [, publishMs] = await timed(async () => {
          for (const userId of members) {
            await publisher.publish(RealtimeChannels.user(id, userId), frame());
          }
        });

        // The same frames, issued in chunks rather than one at a time. ioredis multiplexes
        // one socket, so a chunk leaves as one write rather than as `chunk` round trips.
        const [, chunkedMs] = await timed(async () => {
          for (let index = 0; index < members.length; index += PUBLISH_CHUNK) {
            await Promise.all(
              members
                .slice(index, index + PUBLISH_CHUNK)
                .map((userId) => publisher.publish(RealtimeChannels.user(id, userId), frame())),
            );
          }
        });

        readings.push({
          recipients: size,
          writeMs,
          writeStatements,
          rowsWritten: written.length,
          replayMs,
          rowsOnReplay: replayed.length,
          digestMs,
          digestPages,
          digestStatements,
          publishMs,
          perPublishUs: Math.round((publishMs * 1_000) / size),
          chunkedMs,
          perChunkedUs: Math.round((chunkedMs * 1_000) / size),
        });

        // One row per recipient, and the replay adds none. Both halves matter: the first
        // is the amplification, the second is what stops it happening twice.
        expect(written).toHaveLength(size);
        expect(replayed).toHaveLength(0);

        // One statement per chunk of a thousand, not one per recipient. This is the
        // assertion the whole file is for — an N+1 here is invisible at fifty.
        expect(writeStatements).toBe(Math.ceil(size / WRITE_CHUNK));

        // One query per page, and the last page is the one that ends the loop. A join
        // lifted per row would make this 1 + N and still return the same recipients.
        expect(digestPages).toBe(Math.floor(size / DIGEST_PAGE) + 1);
        expect(digestStatements).toBe(digestPages);
      },
      30 * 60 * 1_000,
    );
  }
});
