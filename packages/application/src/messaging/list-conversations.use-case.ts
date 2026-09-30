import type { ListConversationsInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { ConversationNaming, NamedConversation } from "./conversation-naming.js";
import type { MessageRepository } from "./message.repository.js";

// The record plus the two things that are not on the row: the unread count, which is a
// property of who is asking, and the member names, which live on another placement.
export interface ConversationListItem extends NamedConversation {
  readonly unreadCount: number;
}

export interface ConversationListPage {
  readonly items: readonly ConversationListItem[];
  readonly nextCursor: string | null;
}

export class ListConversationsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly naming: ConversationNaming,
  ) {}

  // Always the actor's own. There is no "list someone else's" — the driving side of the
  // query is their membership rows.
  public async execute(
    actor: Principal,
    input: ListConversationsInput,
  ): Promise<ConversationListPage> {
    this.authorizer.assert(actor, "messaging.conversation.read");

    const page = await this.conversations.listByMember(actor.organizationId, actor.userId, input);
    // One statement for the whole page rather than one per row, and capped: a stale
    // channel costs a hundred index entries and renders "99+".
    const counts = await this.messages.unreadCounts(
      actor.organizationId,
      actor.userId,
      page.items.map((item) => item.id),
    );

    // Also one statement for the page. No transaction is open here, which is what makes
    // a catalog read beside a routed one legal at all.
    const named = await this.naming.attach(actor.organizationId, page.items);

    return {
      items: named.map((item) => ({
        ...item,
        unreadCount: counts.find((count) => count.conversationId === item.id)?.count ?? 0,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
