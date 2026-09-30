import type { ApiClient } from "@loadbearing/api-client";
import { describe, expect, it } from "vitest";
import { MessagingQueries } from "../../src/messaging/messaging.queries.js";

type Page = Awaited<ReturnType<ApiClient["message"]["list"]>>;
type Item = Page["items"][number];

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

const item = (id: string, minute: number, clientId = `c-${id}`): Item =>
  ({
    id,
    conversationId: "conv",
    authorId: "author",
    clientId,
    body: id,
    deleted: false,
    editedAt: null,
    createdAt: at(minute),
  }) as Item;

const page = (items: readonly Item[], olderCursor: string | null = "older"): Page =>
  ({ items, olderCursor }) as Page;

const cached = (...pages: Page[]) => ({
  pages,
  pageParams: pages.map((_, index) => (index === 0 ? undefined : `p${index}`)),
});

describe("MessagingQueries.splice", () => {
  it("puts new rows on the newest page and keeps the older pages as they were", () => {
    const older = page([item("a", 1)]);
    const current = cached(page([item("c", 3), item("b", 2)]), older);

    const next = MessagingQueries.splice(current, page([item("d", 4), item("c", 3)]));

    expect(next.pages[0]?.items.map((row) => row.id)).toEqual(["d", "c", "b"]);
    expect(next.pages[1]).toBe(older);
    expect(next.pageParams).toBe(current.pageParams);
  });

  // The optimistic row carries the client id as its id until the server answers.
  it("replaces an optimistic row by its client id rather than drawing it twice", () => {
    const current = cached(page([item("pending", 5, "pending"), item("b", 2)]));

    const next = MessagingQueries.splice(current, page([item("real", 5, "pending"), item("b", 2)]));

    expect(next.pages[0]?.items.map((row) => row.id)).toEqual(["real", "b"]);
  });

  // More than a page arrived, so the cache cannot be stitched to the fresh page.
  it("starts again from the fresh page when nothing overlaps", () => {
    const current = cached(page([item("b", 2)]), page([item("a", 1)]));
    const fresh = page([item("z", 9)]);

    const next = MessagingQueries.splice(current, fresh);

    expect(next.pages).toEqual([fresh]);
    expect(next.pageParams).toEqual([undefined]);
  });
});
