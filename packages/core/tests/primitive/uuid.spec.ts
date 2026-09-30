import { afterEach, describe, expect, it, vi } from "vitest";
import { Uuid } from "../../src/primitive/uuid.js";

describe("Uuid", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates a value its own validator accepts", () => {
    expect(Uuid.isValid(Uuid.v7())).toBe(true);
  });

  it("stamps the version and variant nibbles", () => {
    const value = Uuid.v7();

    expect(value[14]).toBe("7");
    expect(value[19]).toMatch(/[89ab]/);
  });

  it("encodes the current millisecond in the leading 48 bits", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(at);

    const value = Uuid.v7();
    const leading = value.slice(0, 8) + value.slice(9, 13);

    expect(leading).toBe(at.getTime().toString(16).padStart(12, "0"));
  });

  it("differs between two calls in the same millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(Uuid.v7()).not.toBe(Uuid.v7());
  });

  it("rejects a malformed value", () => {
    expect(Uuid.isValid("not-a-uuid")).toBe(false);
    // Well-formed hex in the right places, variant nibble `0`.
    expect(Uuid.isValid("0195f0a0-0000-7000-0000-000000000000")).toBe(false);
  });

  it("rejects a version nibble no RFC defines, variant or not", () => {
    // The regression: the version position was not looked at, so these passed on a
    // correct variant alone. Neither is an identifier anything mints.
    expect(Uuid.isValid("0195f0a0-0000-0000-8000-000000000000")).toBe(false);
    expect(Uuid.isValid("0195f0a0-0000-9000-8000-000000000000")).toBe(false);
    expect(Uuid.isValid("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(Uuid.isValid("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(false);
  });

  // Deliberately not a v7 assertion: this guards the shape of untrusted input, and an
  // identifier minted elsewhere is still an identifier. See docs/reference/uuid.md.
  it("accepts a well-formed v4", () => {
    expect(Uuid.isValid("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")).toBe(true);
  });
});
