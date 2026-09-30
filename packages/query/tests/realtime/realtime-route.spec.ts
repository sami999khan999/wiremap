import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { QueryKeys } from "../../src/key/index.js";
import { RealtimeRoutes } from "../../src/realtime/realtime-route.js";

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

    RealtimeRoutes.apply(request, "notification.created", { kind: "member.joined" });

    expect(keys).toEqual([QueryKeys.notification.unreadCount(), QueryKeys.notification.lists()]);
  });

  // The gap could have held any frame, so a resync is every route with no ids at all.
  it("resyncs every namespace the table names, derived rather than listed twice", () => {
    const { keys, request } = collect();

    RealtimeRoutes.resync(request);

    expect(keys).toContainEqual(QueryKeys.member.all());
    expect(keys).toContainEqual(QueryKeys.notification.unreadCount());
    expect(keys).toContainEqual(QueryKeys.notification.lists());
  });

  it("names every event the contract declares", () => {
    // The type already fails the build if the table is not total. This catches the
    // reverse: a route left behind for a name the contract has dropped.
    expect([...RealtimeRoutes.names()].sort()).toEqual(["member.changed", "notification.created"]);
  });
});
