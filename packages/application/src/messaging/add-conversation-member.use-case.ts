import { ConflictError, type ConversationMemberInput, NotFoundError } from "../import.js";
import type { DomainEventPublisher, TenantMembershipReader, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { ConversationAccess } from "./conversation-access.js";

export class AddConversationMemberUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly conversations: ConversationRepository,
    private readonly events: DomainEventPublisher,
    private readonly memberships: TenantMembershipReader,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: ConversationMemberInput): Promise<void> {
    this.authorizer.assert(actor, "messaging.conversation.manage");
    const conversation = await this.access.assertMember(actor, input.conversationId);

    // A DM is a pair. Adding a third person would turn one conversation into another
    // while both members were looking at it, and the direct key would then be a lie.
    if (conversation.kind === "direct") throw new ConflictError("conversation", "direct");

    const already = conversation.members.some((member) => member.userId === input.userId);
    if (already) return;

    // The only constraint on this column is `users.id`, not membership, so a holder in
    // one tenant could add a user id from another and probe which ones exist.
    if (!(await this.memberships.isActiveMember(actor.organizationId, input.userId))) {
      throw new NotFoundError("member", input.userId);
    }

    // Write and publish together, as `send` does. A member row with no outbox row is a
    // person in the conversation whose other tabs never learn they are in it.
    await this.unitOfWork.run(async () => {
      await this.conversations.saveMember(
        actor.organizationId,
        input.conversationId,
        input.userId,
        "member",
      );

      await this.events.publish(actor, {
        name: "conversation.member.added",
        payload: { conversationId: input.conversationId, userId: input.userId },
      });
    });
  }
}
