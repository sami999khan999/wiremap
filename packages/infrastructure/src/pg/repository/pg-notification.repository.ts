import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  type NewNotification,
  type NotificationId,
  type NotificationKind,
  type NotificationPage,
  type NotificationRecord,
  type NotificationRepository,
  type OrganizationId,
  type Placement,
  sql,
  type UnreadQuery,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, KeysetCursor } from "../primitive/index.js";
import { notifications } from "../schema/index.js";

// Postgres caps a single insert's parameter count, and a delivery to a large
// organization is the one path that can approach it.
const CHUNK = 1_000;

export class PgNotificationRepository extends BaseRepository implements NotificationRepository {
  // `notifications` is tenant-produced.
  protected override readonly placement: Placement = "routed";

  public async list(
    organizationId: OrganizationId,
    userId: UserId,
    query: UnreadQuery,
  ): Promise<NotificationPage> {
    const after = query.cursor ? KeysetCursor.decode(query.cursor) : null;

    // `limit + 1`: the extra row is how the page knows there is another one, without a
    // count over a partitioned table.
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.userId, userId),
          query.unreadOnly ? isNull(notifications.readAt) : undefined,
          // A row constructor, not `a < x OR (a = x AND b < y)`: the same predicate, and
          // only this form uses `notifications_inbox_idx` as a walk rather than a sort.
          after
            ? sql`(${notifications.createdAt}, ${notifications.id}) < (${after.at}, ${after.id}::uuid)`
            : undefined,
          // Redundant, and the only part the pruner reads: it does not decompose a row
          // constructor, so without this a page three months back plans every newer month.
          after ? sql`${notifications.createdAt} <= ${after.at}` : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => PgNotificationRepository.toRecord(row)),
      nextCursor:
        rows.length > query.limit && last ? KeysetCursor.encode(last.createdAt, last.id) : null,
    };
  }

  // Capped in SQL rather than by slicing the result: `LIMIT` inside the subquery is what
  // stops Postgres counting a hundred thousand index entries to render "99+".
  public async countUnread(
    organizationId: OrganizationId,
    userId: UserId,
    cap: number,
  ): Promise<number> {
    const result = await this.db.execute<{ count: string }>(sql`
      select count(*)::text as count from (
        select 1 from notifications
        where organization_id = ${organizationId}
          and user_id = ${userId}
          and read_at is null
        limit ${cap}
      ) capped
    `);

    return Number(result.rows[0]?.count ?? "0");
  }

  // One statement per chunk for N recipients, and `ON CONFLICT DO NOTHING` on the dedupe
  // index — which is what makes a replayed event write nothing rather than duplicate.
  public async saveMany(records: readonly NewNotification[]): Promise<readonly UserId[]> {
    const written: UserId[] = [];

    for (let index = 0; index < records.length; index += CHUNK) {
      const chunk = records.slice(index, index + CHUNK);

      const inserted = await this.db
        .insert(notifications)
        .values(
          chunk.map((record) => ({
            id: Uuid.v7(),
            organizationId: record.organizationId,
            userId: record.userId,
            eventId: record.eventId,
            kind: record.kind,
            category: record.category,
            params: { ...record.params },
            link: record.link,
            subjectId: record.subjectId,
            // From the event, not `defaultNow()`: the dedupe index carries this column,
            // so a redelivery has to compute the same value to collide with itself.
            createdAt: record.createdAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ userId: notifications.userId });

      written.push(...inserted.map((row) => row.userId));
    }

    return written;
  }

  // One indexed query against `notifications_subject_idx` for the whole audience, and
  // what keeps a burst of ten messages to one bell item rather than ten.
  public async unreadSubjectHolders(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
    kind: NotificationKind,
    subjectId: string,
  ): Promise<ReadonlySet<UserId>> {
    if (userIds.length === 0) return new Set();

    const rows = await this.db
      .selectDistinct({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          inArray(notifications.userId, [...userIds]),
          eq(notifications.kind, kind),
          eq(notifications.subjectId, subjectId),
          isNull(notifications.readAt),
        ),
      );

    return new Set(rows.map((row) => row.userId));
  }

  // `createdAt` in the predicate is the partition hint. Without it Postgres has to look
  // in every month, and a wrong value is simply no rows rather than another user's.
  public async markRead(
    organizationId: OrganizationId,
    userId: UserId,
    id: NotificationId,
    createdAt: Date,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: at })
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.userId, userId),
          eq(notifications.id, id),
          eq(notifications.createdAt, createdAt),
          isNull(notifications.readAt),
        ),
      );
  }

  public async markAllRead(
    organizationId: OrganizationId,
    userId: UserId,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: at })
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
  }

  // One statement for a page of people: a window function keeps each person's newest
  // `perUser`, where a query per person was fifty thousand for a large tenant's digest.
  public async listUnreadBetween(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
    since: Date,
    until: Date,
    perUser: number,
  ): Promise<ReadonlyMap<UserId, readonly NotificationRecord[]>> {
    const grouped = new Map<UserId, NotificationRecord[]>();
    if (userIds.length === 0) return grouped;

    const ranked = this.db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        kind: notifications.kind,
        category: notifications.category,
        params: notifications.params,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        rank: sql<number>`row_number() over (
          partition by ${notifications.userId}
          order by ${notifications.createdAt} desc, ${notifications.id} desc
        )`.as("rank"),
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          inArray(notifications.userId, [...userIds]),
          isNull(notifications.readAt),
          gte(notifications.createdAt, since),
          lt(notifications.createdAt, until),
        ),
      )
      .as("ranked");

    const rows = await this.db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, perUser))
      .orderBy(asc(ranked.userId), desc(ranked.createdAt), desc(ranked.id));

    for (const row of rows) {
      const records = grouped.get(row.userId) ?? [];
      records.push(PgNotificationRepository.toRecord(row));
      grouped.set(row.userId, records);
    }

    return grouped;
  }

  // Keyset on the user id, which is the only stable order this page has. It prunes to
  // the tenant partition on `organization_id` and to the months the window reaches.
  public async recipientsWithUnreadBetween(
    organizationId: OrganizationId,
    since: Date,
    until: Date,
    limit: number,
    afterUserId: UserId | null,
  ): Promise<readonly UserId[]> {
    const rows = await this.db
      .selectDistinct({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          isNull(notifications.readAt),
          gte(notifications.createdAt, since),
          lt(notifications.createdAt, until),
          afterUserId ? gt(notifications.userId, afterUserId) : undefined,
        ),
      )
      .orderBy(asc(notifications.userId))
      .limit(limit);

    return rows.map((row) => row.userId);
  }

  private static toRecord(
    row: Pick<
      typeof notifications.$inferSelect,
      "id" | "kind" | "category" | "params" | "link" | "readAt" | "createdAt"
    >,
  ): NotificationRecord {
    return {
      id: row.id as NotificationId,
      kind: row.kind as NotificationRecord["kind"],
      category: row.category as NotificationRecord["category"],
      params: row.params,
      link: row.link,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
