import type { ConversationId } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationAccess } from "./conversation-access.js";

// What a conversation stream asks when it opens, and again for as long as it stays open:
// the reading question, without the roster, the unread count or the names `get` attaches.
export class WatchConversationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
  ) {}

  public async execute(actor: Principal, conversationId: ConversationId): Promise<void> {
    this.authorizer.assert(actor, "messaging.conversation.read");
    await this.access.assertParticipant(actor, conversationId);
  }
}
