import {
  type Clock,
  ConflictError,
  type ConversationKind,
  type MessageId,
  type SendMessageInput,
  Uuid,
} from "../import.js";
import type {
  CacheStore,
  DomainEventPublisher,
  RealtimePublisher,
  UnitOfWork,
} from "../port/index.js";
import { type Authorizer, type Principal, RealtimeChannels } from "../primitive/index.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { ConversationAccess } from "./conversation-access.js";
import type { MessageRecord, MessageRepository } from "./message.repository.js";

// A day. Long enough that no client retries past it, short enough that the dedupe set is
// bounded by a day of traffic rather than by the conversation's whole history.
const DEDUPE_TTL_SECONDS = 86_400;

// How long a claim whose row is not there yet reads as "still being written" rather than
// "rolled back". Longer than any send transaction, shorter than a person's patience.
const IN_FLIGHT_MS = 10_000;

// What the dedupe key holds: enough to find the row the first attempt wrote, and nothing
// else — `findById` carries `createdAt` as the partition hint.
interface HeldSend {
  readonly id: MessageId;
  readonly createdAt: string;
}

export class SendMessageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly access: ConversationAccess,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly events: DomainEventPublisher,
    private readonly realtime: RealtimePublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly cache: CacheStore,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: SendMessageInput): Promise<MessageRecord> {
    this.authorizer.assert(actor, "messaging.message.send");
    const conversation = await this.access.assertParticipant(actor, input.conversationId);

    // Generated here, not in the repository: the dedupe key holds them, which is what
    // lets a retry be handed the row the first attempt wrote.
    const id = Uuid.v7() as MessageId;
    const createdAt = this.clock.now();
    const key = SendMessageUseCase.key(actor, input.conversationId, input.clientId);

    // A unique index on `messages` would have to carry `created_at`, which a retry never
    // reproduces — so the dedupe is one `SET … EX … NX`. See docs/reference/messaging.md.
    const claimed = await this.cache.setIfAbsent<HeldSend>(
      key,
      { id, createdAt: createdAt.toISOString() },
      DEDUPE_TTL_SECONDS,
    );

    if (!claimed) {
      const previous = await this.cache.get<HeldSend>(key);
      const held = previous ? await this.replay(actor, input, previous) : null;

      // Returned without touching the conversation, the outbox or the fast path, so the
      // two attempts stay indistinguishable — which is what the old `DO UPDATE` bought.
      if (held) return held;

      // A claim whose row is not there *yet* is the first attempt still running, not a
      // rollback: its transaction is open, so `findById` cannot see what it wrote.
      if (previous && createdAt.getTime() - Date.parse(previous.createdAt) < IN_FLIGHT_MS) {
        throw new ConflictError("message", "inFlight");
      }

      // Past the window the first attempt is gone, and it rolled back after setting the
      // key. Take the claim over, so the next retry finds this attempt's row.
      await this.cache.set<HeldSend>(
        key,
        { id, createdAt: createdAt.toISOString() },
        DEDUPE_TTL_SECONDS,
      );
    }

    const message = await this.unitOfWork.run(() =>
      this.write(actor, input, conversation.kind, id, createdAt),
    );

    // The **fast path**, after the commit and best effort. The subscriber publishes the
    // same frame durably, and the client dedupes by message id — so a lost one costs nothing.
    await this.realtime.publish(
      RealtimeChannels.conversation(actor.organizationId, input.conversationId),
      {
        kind: "event",
        id: Uuid.v7(),
        name: "message.sent",
        at: message.createdAt,
        payload: { conversationId: input.conversationId, messageId: message.id },
      },
    );

    return message;
  }

  // Null means the claim is held and the row is not there — either the first attempt is
  // still inside its transaction, or it rolled back. The caller tells those apart.
  private async replay(
    actor: Principal,
    input: SendMessageInput,
    held: HeldSend,
  ): Promise<MessageRecord | null> {
    return this.messages.findById(
      actor.organizationId,
      input.conversationId,
      held.id,
      new Date(held.createdAt),
    );
  }

  // No `activity.record`. Chat volume is not an audit trail, and the outbox row is the
  // durable fact — writing both would double the write rate for nobody's benefit.
  private async write(
    actor: Principal,
    input: SendMessageInput,
    conversationKind: ConversationKind,
    id: MessageId,
    createdAt: Date,
  ): Promise<MessageRecord> {
    const message = await this.messages.save({
      id,
      createdAt,
      organizationId: actor.organizationId,
      conversationId: input.conversationId,
      authorId: actor.userId,
      clientId: input.clientId,
      body: input.body,
    });

    await this.conversations.touch(
      actor.organizationId,
      input.conversationId,
      message.id,
      message.createdAt,
    );

    await this.events.publish(actor, {
      name: "message.sent",
      payload: {
        conversationId: input.conversationId,
        messageId: message.id,
        createdAt: message.createdAt,
        conversationKind,
      },
    });

    return message;
  }

  // Scoped to the conversation as well as the tenant, so two clients that happened to
  // generate one uuid do not collide across rooms — the old unique index's shape.
  private static key(actor: Principal, conversationId: string, clientId: string): string {
    return `message:client:${actor.organizationId}:${conversationId}:${clientId}`;
  }
}
