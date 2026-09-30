import { ConflictError, type LeaveConversationInput } from "../import.js";
import type { DomainEventPublisher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { ConversationAccess } from "./conversation-access.js";
import { MessagingRules } from "./messaging.rules.js";

export class LeaveConversationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly conversations: ConversationRepository,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  // On `read`, not `manage`: leaving is something anyone in a conversation may always
  // do, and gating it behind administration would trap people in channels.
  public async execute(actor: Principal, input: LeaveConversationInput): Promise<void> {
    this.authorizer.assert(actor, "messaging.conversation.read");
    const conversation = await this.access.assertMember(actor, input.conversationId);

    // Leaving a DM would leave the other person talking to nobody, and the direct key
    // would then match a conversation they cannot be re-added to.
    if (conversation.kind === "direct") throw new ConflictError("conversation", "direct");

    const self = conversation.members.find((member) => member.userId === actor.userId);
    const owners = conversation.members.filter((member) => MessagingRules.isOwner(member.role));
    if (self && MessagingRules.isOwner(self.role) && owners.length === 1) {
      throw new ConflictError("conversation", "lastOwner");
    }

    // Write and publish together, as `send` does. Leaving with no outbox row keeps the
    // conversation in everyone else's member list until the next full refetch.
    await this.unitOfWork.run(async () => {
      await this.conversations.deleteMember(
        actor.organizationId,
        input.conversationId,
        actor.userId,
      );

      await this.events.publish(actor, {
        name: "conversation.member.removed",
        payload: { conversationId: input.conversationId, userId: actor.userId },
      });
    });
  }
}
