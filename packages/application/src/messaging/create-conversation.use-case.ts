import {
  ConflictError,
  type CreateConversationInput,
  NotFoundError,
  type UserId,
} from "../import.js";
import type { DomainEventPublisher, TenantMembershipReader, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationRecord, ConversationRepository } from "./conversation.repository.js";
import type { ConversationNaming } from "./conversation-naming.js";
import type { ConversationListItem } from "./list-conversations.use-case.js";
import { MessagingRules } from "./messaging.rules.js";

export class CreateConversationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly conversations: ConversationRepository,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly memberships: TenantMembershipReader,
    private readonly naming: ConversationNaming,
  ) {}

  public async execute(
    actor: Principal,
    input: CreateConversationInput,
  ): Promise<ConversationListItem> {
    this.authorizer.assert(actor, "messaging.conversation.create");

    const other = input.memberIds[0];
    if (input.kind === "direct" && other === actor.userId) {
      throw new ConflictError("conversation", "self");
    }

    // Membership is the only thing that scopes these ids to the tenant: the column's
    // foreign key is `users.id`, which every tenant's people share.
    const others = input.memberIds.filter((userId) => userId !== actor.userId);
    const active = await this.memberships.activeMemberIds(actor.organizationId, others);
    const stranger = others.find((userId) => !active.has(userId));
    if (stranger) throw new NotFoundError("member", stranger);

    const directKey =
      input.kind === "direct" && other ? MessagingRules.directKey(actor.userId, other) : null;

    // Read first for the common case — opening a DM you already have — so the ordinary
    // path is one query rather than an insert that conflicts.
    if (directKey) {
      const existing = await this.conversations.findByDirectKey(actor.organizationId, directKey);
      // Zero rather than counted: this path returns a conversation the caller is about to
      // open, and the list it came from carries the real number.
      if (existing) return this.named(actor, existing);
    }

    const conversation = await this.unitOfWork.run(() => this.insert(actor, input, directKey));

    // **After the transaction, never inside it.** `insert` runs in a routed unit of work
    // and the names come off the catalog, which is the crossing `data.md` forbids.
    return this.named(actor, conversation);
  }

  private async named(actor: Principal, conversation: ConversationRecord) {
    const item = await this.naming.attachOne(actor.organizationId, conversation);
    return { ...item, unreadCount: 0 };
  }

  private async insert(
    actor: Principal,
    input: CreateConversationInput,
    directKey: string | null,
  ): Promise<ConversationRecord> {
    const members: readonly UserId[] = [
      actor.userId,
      ...input.memberIds.filter((id) => id !== actor.userId),
    ];

    const id = await this.conversations.save({
      organizationId: actor.organizationId,
      kind: input.kind,
      title: input.title ?? null,
      directKey,
      createdBy: actor.userId,
      memberIds: members,
    });

    // Read back rather than assembling the record here: on a conflict the row is the one
    // somebody else wrote a millisecond ago, and its members are theirs, not this input's.
    const conversation = await this.conversations.findById(actor.organizationId, id);
    if (!conversation) throw new ConflictError("conversation", "vanished");

    await this.events.publish(actor, {
      name: "conversation.created",
      payload: { conversationId: conversation.id, kind: conversation.kind },
    });

    return conversation;
  }
}
