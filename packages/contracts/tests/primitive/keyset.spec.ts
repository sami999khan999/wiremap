import { describe, expect, it } from "vitest";
import { Keyset } from "../../src/primitive/keyset.js";

const page = Keyset.page(
  // Any item schema; the assertions here are about the envelope, not the row.
  (await import("../../src/import.js")).z.object({
    id: (await import("../../src/import.js")).z.string(),
  }),
);

describe("Keyset.query", () => {
  it("defaults to fifty and no cursor, so a first page needs no arguments", () => {
    expect(Keyset.query.parse({})).toEqual({ limit: 50 });
  });

  // The bound is in the schema rather than a handler, so the worker inherits it too.
  it("refuses a limit past the cap", () => {
    expect(Keyset.query.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("refuses a cursor long enough to be a payload", () => {
    expect(Keyset.query.safeParse({ cursor: "a".repeat(257) }).success).toBe(false);
  });
});

describe("Keyset.page", () => {
  it("has no total, which is the cost keyset pagination exists to avoid", () => {
    expect(Object.keys(page.shape)).toEqual(["items", "nextCursor"]);
  });

  // A full page can still be the last one, so "no cursor" and "no items" are different
  // answers and a client that conflated them would fetch again forever.
  it("distinguishes a last page from an empty one", () => {
    expect(page.parse({ items: [{ id: "a" }], nextCursor: null }).nextCursor).toBeNull();
    expect(page.parse({ items: [], nextCursor: "abc" }).nextCursor).toBe("abc");
  });
});
