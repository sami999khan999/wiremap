import type {
  ConversationId,
  ConversationKind,
  ConversationMemberRole,
  KeysetQuery,
  MessageId,
  OrganizationId,
  UserId,
} from "../import.js";

export interface ConversationMemberRecord {
  readonly userId: UserId;
  readonly role: ConversationMemberRole;
  readonly joinedAt: Date;
  readonly lastReadAt: Date | null;
}

// Everything but the roster, which is what a check that the caller is in the room returns.
export interface ConversationHeader {
  readonly id: ConversationId;
  readonly kind: ConversationKind;
  readonly title: string | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly lastMessageAt: Date | null;
  readonly lastMessageId: MessageId | null;
}

export interface ConversationRecord extends ConversationHeader {
  readonly members: readonly ConversationMemberRecord[];
}

export interface ConversationPage {
  readonly items: readonly ConversationRecord[];
  readonly nextCursor: string | null;
}

export interface NewConversation {
  readonly organizationId: OrganizationId;
  readonly kind: ConversationKind;
  readonly title: string | null;
  readonly directKey: string | null;
  readonly createdBy: UserId;
  readonly memberIds: readonly UserId[];
}

// Every method takes the tenant first, and none of them can be called without it — the
// shape that makes a forgotten scope a compile error rather than a leak.
export abstract class ConversationRepository {
  public abstract listByMember(
    organizationId: OrganizationId,
    userId: UserId,
    page: KeysetQuery,
  ): Promise<ConversationPage>;

  public abstract findById(
    organizationId: OrganizationId,
    conversationId: ConversationId,
  ): Promise<ConversationRecord | null>;

  // The header when `userId` is a member; null when they are not, or it does not exist. One
  // join, where `findById` also reads every member row — a large channel on every send.
  public abstract findMembership(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<ConversationHeader | null>;

  public abstract findByDirectKey(
    organizationId: OrganizationId,
    directKey: string,
  ): Promise<ConversationRecord | null>;

  // Returns the id of the row that exists, inserted or not: two people opening the same
  // DM at once get one row and both are handed its id, where `DO NOTHING` returns neither.
  public abstract save(conversation: NewConversation): Promise<ConversationId>;

  public abstract isMember(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<boolean>;

  // Ordered by user id. `limit` with no `after` caps a fan-out, as the recipient read does;
  // with `after` it is a keyset page, which is how the realtime fan-out walks a big room.
  public abstract memberIds(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    limit?: number,
    after?: UserId | null,
  ): Promise<readonly UserId[]>;

  public abstract saveMember(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    role: ConversationMemberRole,
  ): Promise<void>;

  public abstract deleteMember(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<void>;

  public abstract rename(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    title: string,
  ): Promise<void>;

  // `SET last_read_at = GREATEST(last_read_at, ?)`, so a late-arriving mark for an older
  // message cannot move the position backwards. Idempotent by construction.
  public abstract markRead(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    messageId: MessageId,
    at: Date,
  ): Promise<void>;

  // Only ever forward: two sends committing out of order must not leave the older one as
  // the conversation's latest.
  public abstract touch(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    lastMessageId: MessageId,
    lastMessageAt: Date,
  ): Promise<void>;
}
