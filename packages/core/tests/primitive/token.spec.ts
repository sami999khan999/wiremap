import { describe, expect, it } from "vitest";
import { Token } from "../../src/primitive/token.js";

// Two hex characters per byte, so the default is 64 characters over 32 bytes of entropy.
const HEX = /^[0-9a-f]+$/;

describe("Token.random", () => {
  it("is hex, and twice as long as the byte count it was asked for", () => {
    expect(Token.random()).toMatch(HEX);
    expect(Token.random()).toHaveLength(64);
    expect(Token.random(8)).toHaveLength(16);
    expect(Token.random(1)).toHaveLength(2);
  });

  // A byte under 0x10 renders as one character without padding, and a token that is
  // sometimes 63 characters is one that sometimes collides on a fixed-width column.
  it("pads every byte to two characters", () => {
    const lengths = new Set(Array.from({ length: 200 }, () => Token.random(4).length));

    expect([...lengths]).toEqual([8]);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => Token.random()));

    expect(seen.size).toBe(500);
  });
});

describe("Token.hash", () => {
  // The digest is what a lookup is keyed on, so two runs of the same value in two
  // processes have to agree. A salted hash here would make every lookup a scan.
  it("is deterministic and is not the value", async () => {
    const value = Token.random();

    expect(await Token.hash(value)).toBe(await Token.hash(value));
    expect(await Token.hash(value)).not.toBe(value);
  });

  it("is SHA-256, hex, and 64 characters", async () => {
    // The published digest of the empty string. A different algorithm, a different
    // encoding, or a truncation all fail here rather than in production.
    expect(await Token.hash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await Token.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("separates two values that differ by one character", async () => {
    expect(await Token.hash("token-a")).not.toBe(await Token.hash("token-b"));
  });
});
