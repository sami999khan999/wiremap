import type {
  KeysetQuery,
  NotificationCategory,
  NotificationDto,
  NotificationId,
  NotificationKind,
  OrganizationId,
  UserId,
} from "../import.js";

export interface NotificationRecord {
  readonly id: NotificationId;
  readonly kind: NotificationKind;
  readonly category: NotificationCategory;
  readonly params: Readonly<Record<string, string>>;
  readonly link: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NotificationPage {
  readonly items: readonly NotificationRecord[];
  readonly nextCursor: string | null;
}

// What `saveMany` writes. `eventId` is the idempotency key, not decoration: delivery is
// at-least-once, so a replayed event has to find a row rather than write a second one.
export interface NewNotification {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly eventId: string;
  readonly kind: NotificationKind;
  readonly category: NotificationCategory;
  readonly params: Readonly<Record<string, string>>;
  readonly link: string | null;
  // What the notification is about, when that is narrower than the event — a
  // conversation id, say. Null for the rows whose subject is the event itself.
  readonly subjectId: string | null;
  // The **event's** timestamp, never the clock's. It is part of the dedupe key, which a
  // partitioned table forces to carry the partition column — see the pg schema.
  readonly createdAt: Date;
}

export interface UnreadQuery extends KeysetQuery {
  readonly unreadOnly: boolean;
}

export abstract class NotificationRepository {
  public abstract list(
    organizationId: OrganizationId,
    userId: UserId,
    query: UnreadQuery,
  ): Promise<NotificationPage>;

  // Capped rather than exact: past the cap the badge reads "99+", and the true number is
  // a count nobody looks at over a table that grows forever.
  public abstract countUnread(
    organizationId: OrganizationId,
    userId: UserId,
    cap: number,
  ): Promise<number>;

  // One statement for N recipients, and `ON CONFLICT DO NOTHING` on the dedupe index.
  // Returns how many rows were new, which is what tells the caller whom to notify.
  public abstract saveMany(records: readonly NewNotification[]): Promise<readonly UserId[]>;

  // Which of these people already hold an unread one of these about this thing. One indexed
  // query for the whole audience — what keeps a burst of ten messages to one bell item.
  public abstract unreadSubjectHolders(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
    kind: NotificationKind,
    subjectId: string,
  ): Promise<ReadonlySet<UserId>>;

  // `createdAt` is the partition hint. Without it Postgres has to look in every month.
  public abstract markRead(
    organizationId: OrganizationId,
    userId: UserId,
    id: NotificationId,
    createdAt: Date,
    at: Date,
  ): Promise<void>;

  public abstract markAllRead(
    organizationId: OrganizationId,
    userId: UserId,
    at: Date,
  ): Promise<void>;

  // The digest's page: each person's unread rows in `[since, until)`, newest first and at
  // most `perUser` each, in one query. Half-open, so a row is in exactly one day's digest.
  public abstract listUnreadBetween(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
    since: Date,
    until: Date,
    perUser: number,
  ): Promise<ReadonlyMap<UserId, readonly NotificationRecord[]>>;

  // The digest's candidate list, keyset on the user id. Driven by unread rows rather
  // than by stored preferences: a reader on the policy default has no row to be found by.
  public abstract recipientsWithUnreadBetween(
    organizationId: OrganizationId,
    since: Date,
    until: Date,
    limit: number,
    afterUserId: UserId | null,
  ): Promise<readonly UserId[]>;
}

export type { NotificationDto };
