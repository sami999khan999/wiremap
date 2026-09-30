import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Envelope } from "../../src/primitive/envelope.js";

const listOfNames = Envelope.paginated(z.object({ name: z.string() }));

describe("Envelope", () => {
  it("wraps an item schema in the one list shape", () => {
    const parsed = listOfNames.parse({
      items: [{ name: "a" }],
      total: 1,
      limit: 25,
      offset: 0,
    });

    expect(parsed.items).toEqual([{ name: "a" }]);
  });

  it("validates the items with the schema it was given", () => {
    const bad = listOfNames.safeParse({ items: [{ name: 1 }], total: 1, limit: 25, offset: 0 });
    expect(bad.success).toBe(false);
  });

  it("requires the counters, so a handler cannot return a bare array", () => {
    expect(listOfNames.safeParse({ items: [] }).success).toBe(false);
  });

  it("acknowledged is a closed literal", () => {
    expect(Envelope.acknowledged.parse({ ok: true })).toEqual({ ok: true });
    expect(Envelope.acknowledged.safeParse({ ok: false }).success).toBe(false);
  });
});
