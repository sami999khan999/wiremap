import type { ListMessagesInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationAccess } from "./conversation-access.js";
import type { MessagePageResult, MessageRepository } from "./message.repository.js";

export class ListMessagesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly messages: MessageRepository,
  ) {}

  public async execute(actor: Principal, input: ListMessagesInput): Promise<MessagePageResult> {
    this.authorizer.assert(actor, "messaging.conversation.read");
    // The permission says this person may read conversations; this says which. A third
    // member of the organization gets FORBIDDEN here, not an empty page.
    const conversation = await this.access.assertParticipant(actor, input.conversationId);

    // No message yet is no page, and no query: nothing below the header can exist.
    if (!conversation.lastMessageAt) return { items: [], olderCursor: null };

    // The newest message's time bounds the first page, so it reads the months up to it
    // rather than every month `messages` holds. See docs/reference/messaging.md.
    return this.messages.list(actor.organizationId, {
      conversationId: input.conversationId,
      limit: input.limit,
      before: input.before,
      upTo: conversation.lastMessageAt,
    });
  }
}
