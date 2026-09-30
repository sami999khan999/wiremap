import {
  and,
  asc,
  type ConversationHeader,
  type ConversationId,
  type ConversationMemberRecord,
  type ConversationMemberRole,
  type ConversationPage,
  type ConversationRecord,
  type ConversationRepository,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  type KeysetQuery,
  lt,
  type MessageId,
  type NewConversation,
  type OrganizationId,
  or,
  type Placement,
  sql,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, KeysetCursor } from "../primitive/index.js";
import { conversationMembers, conversations } from "../schema/index.js";

interface ConversationRow {
  readonly id: ConversationId;
  readonly kind: string;
  readonly title: string | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly lastMessageAt: Date | null;
  readonly lastMessageId: MessageId | null;
}

// The sample's row as `pg` hands it back: uuids as text, timestamps as strings.
type SampleRow = {
  conversation_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  last_read_at: string | null;
};

export class PgConversationRepository extends BaseRepository implements ConversationRepository {
  // `conversations` is tenant-produced.
  protected override readonly placement: Placement = "routed";

  // Enough to name an untitled channel after someone in it; the reader comes on top.
  private static readonly MEMBER_SAMPLE = 5;

  // Two statements for a page regardless of its size: the conversations, then a sample
  // of each one's members. One query per row would be N+1 by construction.
  public async listByMember(
    organizationId: OrganizationId,
    userId: UserId,
    page: KeysetQuery,
  ): Promise<ConversationPage> {
    const after = page.cursor ? KeysetCursor.decode(page.cursor) : null;

    // The sort key, not `last_message_at`: that is null until the first message, and a
    // null in the row constructor below makes the comparison null rather than true.
    // ──
    // `mapWith`, because an expression has no column to take a mapper from: drizzle
    // hands timestamps back as strings otherwise and the cursor was built from one.
    const recentAt =
      sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`.mapWith(
        conversations.createdAt,
      );

    const rows = await this.db
      .select({
        recentAt,
        id: conversations.id,
        kind: conversations.kind,
        title: conversations.title,
        createdBy: conversations.createdBy,
        createdAt: conversations.createdAt,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageId: conversations.lastMessageId,
      })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, conversations.id),
          eq(conversationMembers.organizationId, conversations.organizationId),
        ),
      )
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversationMembers.userId, userId),
          // A row constructor, not `a < x OR (a = x AND b < y)`: only this form walks
          // `conversations_recent_idx` rather than sorting it.
          after
            ? sql`(${recentAt}, ${conversations.id}) < (${after.at}, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(recentAt), desc(conversations.id))
      .limit(page.limit + 1);

    const window = rows.slice(0, page.limit);
    const last = window.at(-1);
    const members = await this.sampleOf(
      organizationId,
      userId,
      window.map((row) => row.id),
    );

    return {
      items: window.map((row) => PgConversationRepository.toRecord(row, members.get(row.id) ?? [])),
      // No null branch any more. `recentAt` falls back to `created_at`, which is not
      // null — a page ending on a conversation with no messages used to truncate here.
      nextCursor:
        rows.length > page.limit && last ? KeysetCursor.encode(last.recentAt, last.id) : null,
    };
  }

  public async findById(
    organizationId: OrganizationId,
    conversationId: ConversationId,
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId)),
      )
      .limit(1);
    if (!row) return null;

    const members = await this.membersOf(organizationId, [conversationId]);
    return PgConversationRepository.toRecord(row, members.get(conversationId) ?? []);
  }

  public async findMembership(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<ConversationHeader | null> {
    const [row] = await this.db
      .select({ conversation: conversations })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.organizationId, conversations.organizationId),
          eq(conversationMembers.conversationId, conversations.id),
        ),
      )
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.id, conversationId),
          eq(conversationMembers.userId, userId),
        ),
      )
      .limit(1);

    return row ? PgConversationRepository.toHeader(row.conversation) : null;
  }

  public async findByDirectKey(
    organizationId: OrganizationId,
    directKey: string,
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.directKey, directKey),
        ),
      )
      .limit(1);

    return row ? this.findById(organizationId, row.id) : null;
  }

  // `DO UPDATE` rather than `DO NOTHING`, so a conflict still returns the id: two people
  // opening the same DM at once are handed one row and neither gets nothing back.
  public async save(conversation: NewConversation): Promise<ConversationId> {
    const id = Uuid.v7() as ConversationId;

    const [row] = await this.db
      .insert(conversations)
      .values({
        id,
        organizationId: conversation.organizationId,
        kind: conversation.kind,
        title: conversation.title,
        directKey: conversation.directKey,
        createdBy: conversation.createdBy,
      })
      .onConflictDoUpdate({
        target: [conversations.organizationId, conversations.directKey],
        targetWhere: sql`direct_key is not null`,
        set: { directKey: sql`excluded.direct_key` },
      })
      .returning({ id: conversations.id });

    const created = row?.id ?? id;

    await this.db
      .insert(conversationMembers)
      .values(
        conversation.memberIds.map((userId) => ({
          id: Uuid.v7(),
          organizationId: conversation.organizationId,
          conversationId: created,
          userId,
          role: userId === conversation.createdBy ? "owner" : "member",
        })),
      )
      .onConflictDoNothing();

    return created;
  }

  public async isMember(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(PgConversationRepository.member(organizationId, conversationId, userId))
      .limit(1);

    return row !== undefined;
  }

  // Ordered, so two calls over the same conversation return the same page — without
  // it a capped read would hand back a different slice each time.
  public async memberIds(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    limit?: number,
    after?: UserId | null,
  ): Promise<readonly UserId[]> {
    const query = this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.organizationId, organizationId),
          eq(conversationMembers.conversationId, conversationId),
          after ? gt(conversationMembers.userId, after) : undefined,
        ),
      )
      .orderBy(asc(conversationMembers.userId));

    const rows = await (limit === undefined ? query : query.limit(limit));

    return rows.map((row) => row.userId);
  }

  public async saveMember(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    role: ConversationMemberRole,
  ): Promise<void> {
    await this.db
      .insert(conversationMembers)
      .values({ id: Uuid.v7(), organizationId, conversationId, userId, role })
      .onConflictDoNothing();
  }

  public async deleteMember(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<void> {
    await this.db
      .delete(conversationMembers)
      .where(PgConversationRepository.member(organizationId, conversationId, userId));
  }

  public async rename(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    title: string,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ title })
      .where(
        and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId)),
      );
  }

  // `GREATEST`, so a mark that arrives late for an older message cannot move the reader
  // backwards. That is what makes the call idempotent rather than merely repeatable.
  public async markRead(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    messageId: MessageId,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(conversationMembers)
      .set({
        lastReadAt: sql`greatest(${conversationMembers.lastReadAt}, ${at})`,
        lastReadMessageId: sql`case when ${conversationMembers.lastReadAt} is null
          or ${conversationMembers.lastReadAt} < ${at} then ${messageId}
          else ${conversationMembers.lastReadMessageId} end`,
      })
      .where(PgConversationRepository.member(organizationId, conversationId, userId));
  }

  public async touch(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    lastMessageId: MessageId,
    lastMessageAt: Date,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ lastMessageId, lastMessageAt })
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.id, conversationId),
          or(isNull(conversations.lastMessageAt), lt(conversations.lastMessageAt, lastMessageAt)),
        ),
      );
  }

  // A few members per conversation, the reader always among them: the list names a row
  // and nothing more. The whole roster was 100 000 rows for 20 channels of 5 000 (`CR.26`).
  // ──
  // `order by user_id` so the `limit` walks `conversation_members_uq` rather than sorting
  // every member; a direct conversation has two, so it always comes back whole.
  private async sampleOf(
    organizationId: OrganizationId,
    reader: UserId,
    ids: readonly ConversationId[],
  ): Promise<Map<ConversationId, ConversationMemberRecord[]>> {
    const grouped = new Map<ConversationId, ConversationMemberRecord[]>();
    if (ids.length === 0) return grouped;

    const found = await this.db.execute<SampleRow>(sql`
      select c.id::text as conversation_id, m.user_id::text as user_id, m.role,
             m.joined_at, m.last_read_at
      from unnest(array[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]) as c(id)
      cross join lateral (
        (select user_id, role, joined_at, last_read_at from conversation_members
          where organization_id = ${organizationId} and conversation_id = c.id
            and user_id = ${reader})
        union
        (select user_id, role, joined_at, last_read_at from conversation_members
          where organization_id = ${organizationId} and conversation_id = c.id
          order by user_id limit ${PgConversationRepository.MEMBER_SAMPLE})
      ) m
    `);

    for (const row of found.rows) {
      const conversationId = row.conversation_id as ConversationId;
      const existing = grouped.get(conversationId) ?? [];
      existing.push({
        userId: row.user_id as UserId,
        role: row.role as ConversationMemberRole,
        joinedAt: new Date(row.joined_at),
        lastReadAt: row.last_read_at === null ? null : new Date(row.last_read_at),
      });
      grouped.set(conversationId, existing);
    }

    return grouped;
  }

  private async membersOf(
    organizationId: OrganizationId,
    ids: readonly ConversationId[],
  ): Promise<Map<ConversationId, ConversationMemberRecord[]>> {
    const grouped = new Map<ConversationId, ConversationMemberRecord[]>();
    if (ids.length === 0) return grouped;

    const rows = await this.db
      .select()
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.organizationId, organizationId),
          inArray(conversationMembers.conversationId, [...ids]),
        ),
      );

    for (const row of rows) {
      const existing = grouped.get(row.conversationId) ?? [];
      existing.push({
        userId: row.userId,
        role: row.role as ConversationMemberRole,
        joinedAt: row.joinedAt,
        lastReadAt: row.lastReadAt,
      });
      grouped.set(row.conversationId, existing);
    }

    return grouped;
  }

  private static member(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ) {
    return and(
      eq(conversationMembers.organizationId, organizationId),
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
    );
  }

  private static toRecord(
    row: ConversationRow,
    members: readonly ConversationMemberRecord[],
  ): ConversationRecord {
    return { ...PgConversationRepository.toHeader(row), members };
  }

  private static toHeader(row: ConversationRow): ConversationHeader {
    return {
      id: row.id,
      kind: row.kind === "channel" ? "channel" : "direct",
      title: row.title,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
      lastMessageId: row.lastMessageId,
    };
  }
}
