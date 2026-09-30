import { describe, expect, it } from "vitest";
import { Locales } from "../../src/primitive/locale.js";

describe("Locales", () => {
  it("narrows an untrusted string", () => {
    expect(Locales.is("bn")).toBe(true);
    expect(Locales.is("de")).toBe(false);
    expect(Locales.is(null)).toBe(false);
    expect(Locales.is(undefined)).toBe(false);
  });

  // `"constructor"` is the class of input this boundary exists for.
  it("rejects a prototype key", () => {
    expect(Locales.is("constructor")).toBe(false);
  });

  it("lets an explicit override win over the header", () => {
    expect(Locales.negotiate("en-GB,en;q=0.9", "bn")).toBe("bn");
  });

  it("takes the first matching tag, ignoring region and weight", () => {
    expect(Locales.negotiate("de-DE,bn-BD;q=0.8,en;q=0.5", null)).toBe("bn");
  });

  it("falls back to the default when nothing matches", () => {
    expect(Locales.negotiate("de-DE,fr;q=0.8", null)).toBe("en");
    expect(Locales.negotiate(null, null)).toBe("en");
    expect(Locales.negotiate("", "de")).toBe("en");
  });
});
