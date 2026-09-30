import { ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { KeysetCursor } from "../../src/pg/primitive/keyset-cursor.js";

const AT = new Date("2026-08-15T10:20:30.400Z");
const ID = "018f8c00-0000-7000-8000-000000000010";

describe("KeysetCursor", () => {
  it("round-trips the instant and the id", () => {
    const decoded = KeysetCursor.decode(KeysetCursor.encode(AT, ID));

    expect(decoded.at.toISOString()).toBe(AT.toISOString());
    expect(decoded.id).toBe(ID);
  });

  // Milliseconds are the tie-break's tie-break. Truncating them puts two rows in the same
  // instant and a page boundary starts repeating or skipping one.
  it("keeps millisecond precision", () => {
    expect(KeysetCursor.decode(KeysetCursor.encode(AT, ID)).at.getMilliseconds()).toBe(400);
  });

  it("is base64url, so it survives a query string untouched", () => {
    expect(KeysetCursor.encode(AT, ID)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // Never a silent first page: a client that reset to the top on every corrupt token
  // would loop through the same rows forever without anyone noticing.
  it("rejects a malformed cursor rather than starting over", () => {
    for (const bad of ["", "notbase64!!", Buffer.from("nope").toString("base64url")]) {
      expect(() => KeysetCursor.decode(bad), bad).toThrow(ValidationError);
    }
  });

  it("rejects a cursor whose timestamp is not a date", () => {
    const bad = Buffer.from(`not-a-date|${ID}`, "utf8").toString("base64url");

    expect(() => KeysetCursor.decode(bad)).toThrow(ValidationError);
  });

  // The id half was unchecked while every consumer casts it `::uuid`, so this decoded
  // cleanly and died deep in Postgres as a `22P02` — a 500, not the error above.
  it("rejects a cursor whose id is not a uuid", () => {
    const bad = Buffer.from("2026-09-01T00:00:00.000Z|x", "utf8").toString("base64url");

    expect(() => KeysetCursor.decode(bad)).toThrow(ValidationError);
  });
});
