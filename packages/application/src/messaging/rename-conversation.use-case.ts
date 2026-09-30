import { ConflictError, type RenameConversationInput } from "../import.js";
import type { DomainEventPublisher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { ConversationAccess } from "./conversation-access.js";

export class RenameConversationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly conversations: ConversationRepository,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: RenameConversationInput): Promise<void> {
    this.authorizer.assert(actor, "messaging.conversation.manage");
    const conversation = await this.access.assertMember(actor, input.conversationId);

    // A direct conversation is titled by who is in it. Accepting a name here would make
    // one person's DM show a label the other never chose.
    if (conversation.kind === "direct") throw new ConflictError("conversation", "direct");

    // Write and publish together, as `send` does. A rename with no outbox row leaves
    // every other tab showing the old title until something else invalidates it.
    await this.unitOfWork.run(async () => {
      await this.conversations.rename(actor.organizationId, input.conversationId, input.title);

      await this.events.publish(actor, {
        name: "conversation.renamed",
        payload: { conversationId: input.conversationId },
      });
    });
  }
}
