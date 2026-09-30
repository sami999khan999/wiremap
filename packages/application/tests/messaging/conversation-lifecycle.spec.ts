import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { AddConversationMemberUseCase } from "../../src/messaging/add-conversation-member.use-case.js";
import type {
  ConversationRecord,
  ConversationRepository,
} from "../../src/messaging/conversation.repository.js";
import { ConversationAccess } from "../../src/messaging/conversation-access.js";
import { ConversationNaming } from "../../src/messaging/conversation-naming.js";
import { CreateConversationUseCase } from "../../src/messaging/create-conversation.use-case.js";
import { LeaveConversationUseCase } from "../../src/messaging/leave-conversation.use-case.js";
import { MessagingRules } from "../../src/messaging/messaging.rules.js";
import { RemoveConversationMemberUseCase } from "../../src/messaging/remove-conversation-member.use-case.js";
import type { DomainEventPublisher, UnitOfWork } from "../../src/port/index.js";
import { TenantMembershipReader } from "../../src/port/index.js";
import {
  ADA,
  authorizer,
  CONVERSATION,
  CountingUnitOfWork,
  conversation,
  GRACE,
  principal,
  RecordingEvents,
  RecordingUserReader,
} from "./messaging-harness.js";

class Conversations {
  public saved = 0;
  public removed: string[] = [];

  public constructor(
    private readonly existing: ConversationRecord | null,
    private readonly row: ConversationRecord = conversation(),
  ) {}

  public findByDirectKey = () => Promise.resolve(this.existing);
  public findById = () => Promise.resolve(this.row);
  public save = () => {
    this.saved += 1;
    return Promise.resolve(CONVERSATION);
  };
  public saveMember = () => Promise.resolve();
  public deleteMember = (_org: unknown, _id: unknown, userId: string) => {
    this.removed.push(userId);
    return Promise.resolve();
  };
}

// Every added user is checked against the tenant now: the column's only constraint is
// `users.id`, which every tenant's people share.
class Memberships extends TenantMembershipReader {
  public constructor(private readonly absent: readonly string[] = []) {
    super();
  }

  public override isActiveMember(
    _organizationId: OrganizationId,
    userId: UserId,
  ): Promise<boolean> {
    return Promise.resolve(!this.absent.includes(userId));
  }

  public override activeMemberIds(
    _organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlySet<UserId>> {
    return Promise.resolve(new Set(userIds.filter((userId) => !this.absent.includes(userId))));
  }
}

const creator = (existing: ConversationRecord | null) => {
  const conversations = new Conversations(existing);
  const events = new RecordingEvents();
  const unitOfWork = new CountingUnitOfWork();
  // Handed the same unit of work, so the reader records whether a transaction was open
  // when the names were resolved. That is the assertion, not the names themselves.
  const users = new RecordingUserReader(undefined, unitOfWork);
  return {
    conversations,
    events,
    users,
    useCase: new CreateConversationUseCase(
      authorizer,
      conversations as unknown as ConversationRepository,
      events as unknown as DomainEventPublisher,
      unitOfWork as unknown as UnitOfWork,
      new Memberships(),
      new ConversationNaming(users),
    ),
  };
};

describe("CreateConversationUseCase", () => {
  // Opening a DM twice is the same intent both times, so the second call is a read.
  it("returns the existing direct conversation rather than a second one", async () => {
    const harness = creator(conversation());

    const result = await harness.useCase.execute(principal(), {
      kind: "direct",
      memberIds: [GRACE],
    });

    expect(result.id).toBe(CONVERSATION);
    expect(harness.conversations.saved).toBe(0);
    expect(harness.events.published).toEqual([]);
  });

  it("creates and publishes when there is none", async () => {
    const harness = creator(null);

    await harness.useCase.execute(principal(), { kind: "direct", memberIds: [GRACE] });

    expect(harness.conversations.saved).toBe(1);
    expect(harness.events.published.map((event) => event.name)).toEqual(["conversation.created"]);
  });

  it("refuses a direct conversation with yourself", async () => {
    const harness = creator(null);

    await expect(
      harness.useCase.execute(principal(), { kind: "direct", memberIds: [ADA] }),
    ).rejects.toThrow("CONFLICT");
  });

  // `conversations` is routed and `users` is catalog, and the crossing is invisible on
  // one node — asserted here rather than found the week of a split.
  it("resolves the names after the transaction, never inside it", async () => {
    const harness = creator(null);

    const result = await harness.useCase.execute(principal(), {
      kind: "direct",
      memberIds: [GRACE],
    });

    expect(harness.users.inTransaction).toEqual([false]);
    expect(result.members.map((member) => member.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  // The early return opens no transaction at all, so this one only pins that it names
  // the row it returns. A DM opened twice used to come back with two bare uuids.
  it("names the existing conversation it returns instead of creating one", async () => {
    const harness = creator(conversation());

    const result = await harness.useCase.execute(principal(), {
      kind: "direct",
      memberIds: [GRACE],
    });

    expect(harness.conversations.saved).toBe(0);
    expect(result.members.map((member) => member.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });
});

const channel = (members: ConversationRecord["members"]) =>
  conversation({ kind: "channel", title: "Deployments", members });

const owner = { userId: ADA, role: "owner" as const, joinedAt: new Date(), lastReadAt: null };
const plain = { userId: GRACE, role: "member" as const, joinedAt: new Date(), lastReadAt: null };

const manager = () =>
  principal(ADA, [
    "messaging.conversation.read",
    "messaging.conversation.manage",
    "messaging.message.send",
  ]);

describe("membership changes", () => {
  // A DM is a pair. Adding a third would turn one conversation into another while both
  // members were looking at it, and the direct key would then be a lie.
  it("refuses to add a member to a direct conversation", async () => {
    const conversations = new Conversations(null, conversation());
    const useCase = new AddConversationMemberUseCase(
      authorizer,
      new ConversationAccess(conversations as unknown as ConversationRepository),
      conversations as unknown as ConversationRepository,
      new RecordingEvents() as unknown as DomainEventPublisher,
      new Memberships(),
      new CountingUnitOfWork() as unknown as UnitOfWork,
    );

    await expect(
      useCase.execute(manager(), { conversationId: CONVERSATION, userId: GRACE }),
    ).rejects.toThrow("CONFLICT");
  });

  // The same rule the organization's last owner has: afterwards nobody could rename the
  // channel or manage who is in it.
  it("refuses to remove the last owner of a channel", async () => {
    const conversations = new Conversations(null, channel([owner, plain]));
    const useCase = new RemoveConversationMemberUseCase(
      authorizer,
      new ConversationAccess(conversations as unknown as ConversationRepository),
      conversations as unknown as ConversationRepository,
      new RecordingEvents() as unknown as DomainEventPublisher,
      new CountingUnitOfWork() as unknown as UnitOfWork,
    );

    await expect(
      useCase.execute(manager(), { conversationId: CONVERSATION, userId: ADA }),
    ).rejects.toThrow("CONFLICT");
    expect(conversations.removed).toEqual([]);
  });

  it("removes an ordinary member", async () => {
    const conversations = new Conversations(null, channel([owner, plain]));
    const useCase = new RemoveConversationMemberUseCase(
      authorizer,
      new ConversationAccess(conversations as unknown as ConversationRepository),
      conversations as unknown as ConversationRepository,
      new RecordingEvents() as unknown as DomainEventPublisher,
      new CountingUnitOfWork() as unknown as UnitOfWork,
    );

    await useCase.execute(manager(), { conversationId: CONVERSATION, userId: GRACE });

    expect(conversations.removed).toEqual([GRACE]);
  });

  // Leaving is on `read`, not `manage`: gating it behind administration would trap
  // people in channels they were added to.
  it("lets an ordinary member leave a channel", async () => {
    const conversations = new Conversations(null, channel([owner, plain]));
    const useCase = new LeaveConversationUseCase(
      authorizer,
      new ConversationAccess(conversations as unknown as ConversationRepository),
      conversations as unknown as ConversationRepository,
      new RecordingEvents() as unknown as DomainEventPublisher,
      new CountingUnitOfWork() as unknown as UnitOfWork,
    );

    await useCase.execute(principal(GRACE, ["messaging.conversation.read"]), {
      conversationId: CONVERSATION,
    });

    expect(conversations.removed).toEqual([GRACE]);
  });

  it("refuses to let the last owner leave, and refuses to leave a DM", async () => {
    const asChannel = new Conversations(null, channel([owner, plain]));
    const asDirect = new Conversations(null, conversation());
    const build = (repo: Conversations) =>
      new LeaveConversationUseCase(
        authorizer,
        new ConversationAccess(repo as unknown as ConversationRepository),
        repo as unknown as ConversationRepository,
        new RecordingEvents() as unknown as DomainEventPublisher,
        new CountingUnitOfWork() as unknown as UnitOfWork,
      );

    await expect(
      build(asChannel).execute(principal(ADA), { conversationId: CONVERSATION }),
    ).rejects.toThrow("CONFLICT");
    await expect(
      build(asDirect).execute(principal(ADA), { conversationId: CONVERSATION }),
    ).rejects.toThrow("CONFLICT");
  });

  it("names the owner role from the rules rather than a literal", () => {
    expect(MessagingRules.isOwner(owner.role)).toBe(true);
    expect(MessagingRules.isOwner(plain.role)).toBe(false);
  });

  // The column's only constraint is `users.id`, which every tenant's people share, so a
  // manager in one tenant could add a user id from another and fan frames to them.
  it("refuses a user who is not a member of the tenant", async () => {
    const conversations = new Conversations(null, channel([owner]));
    const useCase = new AddConversationMemberUseCase(
      authorizer,
      new ConversationAccess(conversations as unknown as ConversationRepository),
      conversations as unknown as ConversationRepository,
      new RecordingEvents() as unknown as DomainEventPublisher,
      new Memberships([GRACE]),
      new CountingUnitOfWork() as unknown as UnitOfWork,
    );

    await expect(
      useCase.execute(manager(), { conversationId: CONVERSATION, userId: GRACE }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
