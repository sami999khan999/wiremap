import { describe, expect, it } from "vitest";
import { Correlation } from "../../src/primitive/correlation.js";

const headers = (value: string | null) => ({ get: () => value });

describe("Correlation", () => {
  it("adopts a well-formed upstream id, so its logs and ours are one trace", () => {
    expect(Correlation.fromHeaders(headers("abc-123"))).toBe("abc-123");
  });

  it("mints when the header is absent", () => {
    const id = Correlation.fromHeaders(headers(null));
    expect(id).toHaveLength(36);
    expect(Correlation.fromHeaders(headers(null))).not.toBe(id);
  });

  it("mints rather than trusting a malformed one", () => {
    // It would otherwise ride every line of the request, straight off the network.
    expect(Correlation.sanitise("a b c")).toBeNull();
    expect(Correlation.sanitise("<script>")).toBeNull();
    expect(Correlation.sanitise("  ")).toBeNull();
    expect(Correlation.sanitise("")).toBeNull();
    expect(Correlation.fromHeaders(headers("a b c"))).not.toBe("a b c");
  });

  it("bounds an oversized id", () => {
    const long = "a".repeat(500);
    expect(Correlation.sanitise(long)).toHaveLength(128);
  });
});
