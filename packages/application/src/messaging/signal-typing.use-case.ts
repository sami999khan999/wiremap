import {
  type ConversationId,
  type OrganizationId,
  type TypingInput,
  type UserId,
  Uuid,
} from "../import.js";
import type { CacheStore, RealtimePublisher } from "../port/index.js";
import { type Authorizer, type Principal, RealtimeChannels } from "../primitive/index.js";
import type { ConversationAccess } from "./conversation-access.js";
import { MessagingRules } from "./messaging.rules.js";

export class SignalTypingUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly realtime: RealtimePublisher,
    private readonly cache: CacheStore,
  ) {}

  public static key(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
  ): string {
    return `typing:${organizationId}:${conversationId}:${userId}`;
  }

  // Stores nothing and publishes one frame. No unit of work and no outbox: a typing
  // signal that arrives late is worse than one that never arrives.
  public async execute(actor: Principal, input: TypingInput): Promise<void> {
    this.authorizer.assert(actor, "messaging.conversation.read");
    await this.access.assertParticipant(actor, input.conversationId);

    const key = SignalTypingUseCase.key(actor.organizationId, input.conversationId, actor.userId);
    // The throttle is a cache entry rather than a counter, because "have I published in
    // the last two seconds" is exactly what a TTL answers and nothing has to expire it.
    if (await this.cache.get<true>(key)) return;

    await this.cache.set(key, true, Math.ceil(MessagingRules.TYPING_INTERVAL_MS / 1_000));

    await this.realtime.publish(
      RealtimeChannels.conversation(actor.organizationId, input.conversationId),
      {
        kind: "typing",
        id: Uuid.v7(),
        conversationId: input.conversationId,
        userId: actor.userId,
        at: new Date(),
      },
    );
  }
}
