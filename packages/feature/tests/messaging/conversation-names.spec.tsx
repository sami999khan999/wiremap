import type { ApiClient } from "@loadbearing/api-client";
import type { ConversationDto, MessageDto } from "@loadbearing/contracts";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationList } from "../../src/messaging/conversation.list.js";
import { MessageList } from "../../src/messaging/message.list.js";
import { TypingNotice } from "../../src/messaging/typing.notice.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const GRACE = "00000000-0000-7000-8000-000000000002";

const direct = (over: Partial<ConversationDto> = {}): ConversationDto =>
  ({
    id: "00000000-0000-7000-8000-0000000000c1",
    kind: "direct",
    title: null,
    createdBy: TEST_USER.id,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    lastMessageAt: null,
    lastMessageId: null,
    members: [
      { userId: TEST_USER.id, name: "Ada", role: "owner", joinedAt: new Date(), lastReadAt: null },
      {
        userId: GRACE,
        name: "Grace Hopper",
        role: "member",
        joinedAt: new Date(),
        lastReadAt: null,
      },
    ],
    unreadCount: 0,
    ...over,
  }) as unknown as ConversationDto;

const message = (over: Partial<MessageDto> = {}): MessageDto =>
  ({
    id: "00000000-0000-7000-8000-0000000000d1",
    conversationId: "00000000-0000-7000-8000-0000000000c1",
    authorId: GRACE,
    clientId: "00000000-0000-7000-8000-0000000000e1",
    body: "hello",
    deleted: false,
    editedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  }) as unknown as MessageDto;

const inboxClient = (items: readonly ConversationDto[]) =>
  ({
    conversation: { list: () => Promise.resolve({ items, nextCursor: null }) },
  }) as unknown as ApiClient;

const threadClient = (items: readonly MessageDto[]) =>
  ({
    message: { list: () => Promise.resolve({ items, olderCursor: null }) },
  }) as unknown as ApiClient;

describe("ConversationList", () => {
  // The defect `23.26b` filed, from the inbox's side: every direct conversation read
  // "Direct message", so a list of them was a list in which no row was findable.
  it("titles a direct conversation after the other person", async () => {
    await renderWithFakes(
      <ConversationList onOpen={() => undefined} />,
      capabilitiesWith([]),
      TEST_USER,
      ["messaging"],
      inboxClient([direct()]),
    );

    await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeDefined());
    expect(screen.queryByText("Direct message")).toBeNull();
  });

  it("keeps a channel's own title", async () => {
    await renderWithFakes(
      <ConversationList onOpen={() => undefined} />,
      capabilitiesWith([]),
      TEST_USER,
      ["messaging"],
      inboxClient([direct({ kind: "channel", title: "Deployments" })]),
    );

    await waitFor(() => expect(screen.getByText("Deployments")).toBeDefined());
  });

  // Copy, never the uuid. This is the assertion that fails if anyone reaches for
  // `userId` as a fallback again.
  it("falls back to the generic label when the other member has no name", async () => {
    const nameless = direct({
      members: [
        {
          userId: TEST_USER.id,
          name: "Ada",
          role: "owner",
          joinedAt: new Date(),
          lastReadAt: null,
        },
        { userId: GRACE, name: null, role: "member", joinedAt: new Date(), lastReadAt: null },
      ],
    } as unknown as Partial<ConversationDto>);

    await renderWithFakes(
      <ConversationList onOpen={() => undefined} />,
      capabilitiesWith([]),
      TEST_USER,
      ["messaging"],
      inboxClient([nameless]),
    );

    await waitFor(() => expect(screen.getByText("Direct message")).toBeDefined());
    expect(screen.queryByText(GRACE)).toBeNull();
  });
});

describe("MessageList", () => {
  it("names the author of each message", async () => {
    await renderWithFakes(
      <MessageList
        conversationId="00000000-0000-7000-8000-0000000000c1"
        nameFor={() => "Grace Hopper"}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["messaging"],
      threadClient([message()]),
    );

    await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeDefined());
  });

  // Not the id. A thread that prints uuids above every line is the same defect one
  // component over.
  it("renders copy rather than an id for an author nobody can name", async () => {
    await renderWithFakes(
      <MessageList conversationId="00000000-0000-7000-8000-0000000000c1" nameFor={() => null} />,
      capabilitiesWith([]),
      TEST_USER,
      ["messaging"],
      threadClient([message()]),
    );

    await waitFor(() => expect(screen.getByText("Someone")).toBeDefined());
    expect(screen.queryByText(GRACE)).toBeNull();
  });
});

describe("TypingNotice", () => {
  it("names who is typing", async () => {
    await renderWithFakes(
      <TypingNotice typing={[GRACE]} nameFor={() => "Grace Hopper"} />,
      capabilitiesWith([]),
      TEST_USER,
      ["messaging"],
    );

    expect(screen.getByText("Grace Hopper is typing…")).toBeDefined();
  });

  // `23.26b` itself: no `nameFor` reached this component, so it printed the uuid the
  // frame carried.
  it("never prints the id it was handed", async () => {
    await renderWithFakes(<TypingNotice typing={[GRACE]} />, capabilitiesWith([]), TEST_USER, [
      "messaging",
    ]);

    expect(screen.getByText("Someone is typing…")).toBeDefined();
    expect(screen.queryByText(new RegExp(GRACE))).toBeNull();
  });
});
