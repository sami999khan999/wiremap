import type { Clock } from "../import.js";
import { type EditMessageInput, ForbiddenError, NotFoundError } from "../import.js";
import type { DomainEventPublisher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationAccess } from "./conversation-access.js";
import type { MessageRecord, MessageRepository } from "./message.repository.js";
import { MessagingRules } from "./messaging.rules.js";

export class EditMessageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly messages: MessageRepository,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: EditMessageInput): Promise<MessageRecord> {
    this.authorizer.assert(actor, "messaging.message.update");
    await this.access.assertParticipant(actor, input.conversationId);

    const existing = await this.messages.findById(
      actor.organizationId,
      input.conversationId,
      input.messageId,
      input.createdAt,
    );
    // A wrong `createdAt` is NOT_FOUND rather than another row: it is a partition hint,
    // and the id half of the lookup is what identifies the message.
    if (!existing || existing.deleted) throw new NotFoundError("message", input.messageId);

    this.assertMayChange(actor, existing);

    const now = this.clock.now();

    // Write and publish together, as `send` does. Outside a transaction the edit could
    // commit and the outbox row not, and no subscriber would ever hear about it.
    return this.unitOfWork.run(async () => {
      const edited = await this.messages.edit(
        actor.organizationId,
        input.messageId,
        input.createdAt,
        input.body,
        now,
      );
      if (!edited) throw new NotFoundError("message", input.messageId);

      await this.events.publish(actor, {
        name: "message.edited",
        payload: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          createdAt: input.createdAt,
        },
      });

      return edited;
    });
  }

  // Your own, inside the window — or `manage`, which is how a moderator reaches somebody
  // else's. The window is what keeps a conversation a record of what was said.
  private assertMayChange(actor: Principal, message: MessageRecord): void {
    if (actor.can("messaging.conversation.manage")) return;

    if (message.authorId !== actor.userId) throw new ForbiddenError("messaging.message.update");
    if (!MessagingRules.withinEditWindow(message.createdAt, this.clock.now())) {
      throw new ForbiddenError("messaging.message.update");
    }
  }
}
