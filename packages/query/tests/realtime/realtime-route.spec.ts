import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { QueryKeys } from "../../src/key/index.js";
import { RealtimeRoutes } from "../../src/realtime/realtime-route.js";

const CONVERSATION = "00000000-0000-7000-8000-000000000001";

const collect = () => {
  const keys: QueryKey[] = [];
  return { keys, request: (key: QueryKey) => keys.push(key) };
};

describe("RealtimeRoutes", () => {
  it("refetches the member namespace for a member frame", () => {
    const { keys, request } = collect();

    RealtimeRoutes.apply(request, "member.changed", {});

    expect(keys).toEqual([QueryKeys.member.all()]);
  });

  // Not the whole namespace: archived months and preferences do not change when a
  // notification arrives, and each one refetched was a request per frame.
  it("refetches the bell count and the lists for a notification frame", () => {
    const { keys, request } = collect();

    RealtimeRoutes.apply(request, "notification.created", { kind: "message.direct" });

    expect(keys).toEqual([QueryKeys.notification.unreadCount(), QueryKeys.notification.lists()]);
  });

  it("narrows a conversation frame to the lists and that one conversation", () => {
    const { keys, request } = collect();

    RealtimeRoutes.apply(request, "conversation.changed", { conversationId: CONVERSATION });

    expect(keys).toEqual([
      QueryKeys.conversation.lists(),
      QueryKeys.conversation.get(CONVERSATION),
    ]);
  });

  it("narrows a message frame to that conversation's messages", () => {
    const { keys, request } = collect();

    RealtimeRoutes.apply(request, "message.sent", { conversationId: CONVERSATION });

    expect(keys).toEqual([QueryKeys.message.list(CONVERSATION)]);
  });

  // A frame from a publisher that predates the ids still refetches, only more broadly.
  it("falls back to the namespace when the payload names no conversation", () => {
    const { keys, request } = collect();

    RealtimeRoutes.apply(request, "conversation.changed", {});

    expect(keys).toEqual([QueryKeys.conversation.all()]);
  });

  // The gap could have held any frame, so a resync is every route with no ids at all.
  it("resyncs every namespace the table names, derived rather than listed twice", () => {
    const { keys, request } = collect();

    RealtimeRoutes.resync(request);

    expect(keys).toContainEqual(QueryKeys.member.all());
    expect(keys).toContainEqual(QueryKeys.notification.unreadCount());
    expect(keys).toContainEqual(QueryKeys.conversation.all());
    expect(keys).toContainEqual(QueryKeys.message.all());
  });

  it("names every event the contract declares", () => {
    // The type already fails the build if the table is not total. This catches the
    // reverse: a route left behind for a name the contract has dropped.
    expect([...RealtimeRoutes.names()].sort()).toEqual([
      "conversation.changed",
      "conversation.read",
      "member.changed",
      "message.deleted",
      "message.edited",
      "message.sent",
      "notification.created",
    ]);
  });
});
