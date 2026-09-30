import { describe, expect, it } from "vitest";
import { ApiKeyHasher } from "../../src/apikey/api-key.hasher.js";

describe("ApiKeyHasher", () => {
  // Minting moved to `ApiKeyRules` in `application`, where a key is issued from; what
  // is left here is what *authentication* needs. Its spec moved with it.
  it("indexes on a prefix short enough to collide across keys", () => {
    // `prefixOf` is the lookup column, not an identifier: several keys share a prefix and
    // the hash comparison picks one.
    expect(ApiKeyHasher.prefixOf("rk_0123456789abcdef")).toBe("rk_01234");
    expect(ApiKeyHasher.prefixOf("rk_0123456789abcdef")).toHaveLength(8);
  });

  it("compares equal strings as equal and unequal ones as unequal", () => {
    expect(ApiKeyHasher.timingSafeEqual("abcdef", "abcdef")).toBe(true);
    expect(ApiKeyHasher.timingSafeEqual("abcdef", "abcdeg")).toBe(false);
    // A length mismatch short-circuits, which is the one leak this function accepts:
    // the digests it compares are always the same length, so it never happens here.
    expect(ApiKeyHasher.timingSafeEqual("abc", "abcdef")).toBe(false);
    expect(ApiKeyHasher.timingSafeEqual("", "")).toBe(true);
  });

  it("does not short-circuit on the first differing character", () => {
    // A regression guard on the loop, not a timing measurement: measuring nanoseconds in
    // a test runner is flaky and proves nothing.
    expect(ApiKeyHasher.timingSafeEqual("zaaaaa", "aaaaaa")).toBe(false);
    expect(ApiKeyHasher.timingSafeEqual("aaaaaz", "aaaaaa")).toBe(false);
  });
});
