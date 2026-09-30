import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import type { ConversationRepository } from "../../src/messaging/conversation.repository.js";
import { ConversationAccess } from "../../src/messaging/conversation-access.js";
import { ConversationNaming } from "../../src/messaging/conversation-naming.js";
import { GetConversationUseCase } from "../../src/messaging/get-conversation.use-case.js";
import { ListConversationsUseCase } from "../../src/messaging/list-conversations.use-case.js";
import type { MessageRepository } from "../../src/messaging/message.repository.js";
import { UserReader } from "../../src/port/index.js";
import {
  ADA,
  authorizer,
  CONVERSATION,
  conversation,
  GRACE,
  ORG,
  OUTSIDER,
  principal,
  RecordingUserReader,
} from "./messaging-harness.js";

const names = (over: Iterable<readonly [UserId, string]> = []) =>
  new RecordingUserReader(new Map([[ADA, "Ada Lovelace"], [GRACE, "Grace Hopper"], ...over]));

describe("ConversationNaming", () => {
  it("attaches the name each member resolves to", async () => {
    const users = names();
    const [named] = await new ConversationNaming(users).attach(ORG, [conversation()]);

    expect(named?.members.map((member) => member.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  // The whole reason the name is not on `ConversationMemberRecord`: a member whose
  // catalog row this tenant cannot reach still has a routed membership row.
  it("leaves a member it cannot resolve as null rather than as an id", async () => {
    const users = names();
    const withStranger = conversation({
      members: [
        { userId: ADA, role: "owner", joinedAt: new Date(), lastReadAt: null },
        { userId: OUTSIDER, role: "member", joinedAt: new Date(), lastReadAt: null },
      ],
    });

    const [named] = await new ConversationNaming(users).attach(ORG, [withStranger]);

    expect(named?.members.map((member) => member.name)).toEqual(["Ada Lovelace", null]);
  });

  // The assertion `data.md` asks for on anything that loops: a page of conversations is
  // one catalog statement, not one per row.
  it("resolves a whole page in one call", async () => {
    const users = names();
    const page = [conversation(), conversation(), conversation()];

    await new ConversationNaming(users).attach(ORG, page);

    expect(users.calls).toHaveLength(1);
  });

  it("issues no statement at all for an empty page", async () => {
    const users = names();

    await new ConversationNaming(users).attach(ORG, []);

    expect(users.calls).toEqual([[]]);
  });
});

class SingleConversation {
  public findById = () => Promise.resolve(conversation());
  public listByMember = () =>
    Promise.resolve({ items: [conversation()], nextCursor: null as string | null });
}

const noUnread = { unreadCounts: () => Promise.resolve([]) } as unknown as MessageRepository;

describe("the read use-cases", () => {
  it("returns named members from the list", async () => {
    const conversations = new SingleConversation() as unknown as ConversationRepository;
    const useCase = new ListConversationsUseCase(
      authorizer,
      conversations,
      noUnread,
      new ConversationNaming(names()),
    );

    const page = await useCase.execute(principal(), { limit: 25 });

    expect(page.items[0]?.members.map((member) => member.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("returns named members from a single conversation", async () => {
    const conversations = new SingleConversation() as unknown as ConversationRepository;
    const useCase = new GetConversationUseCase(
      authorizer,
      new ConversationAccess(conversations),
      noUnread,
      new ConversationNaming(names()),
    );

    const result = await useCase.execute(principal(), CONVERSATION);

    expect(result.members.map((member) => member.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });
});

// A reader that answers with somebody else's row, to pin that the map is keyed rather
// than positional. Zipping two arrays by index is the bug this spec exists to catch.
class ShuffledReader extends UserReader {
  public namesOf(
    _organizationId: OrganizationId,
    _userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>> {
    return Promise.resolve(new Map([[GRACE, "Grace Hopper"]]));
  }
}

describe("ConversationNaming, keyed not zipped", () => {
  it("does not hand one member another's name", async () => {
    const [named] = await new ConversationNaming(new ShuffledReader()).attach(ORG, [
      conversation(),
    ]);

    expect(named?.members).toEqual([
      expect.objectContaining({ userId: ADA, name: null }),
      expect.objectContaining({ userId: GRACE, name: "Grace Hopper" }),
    ]);
  });
});
