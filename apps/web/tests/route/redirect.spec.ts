import { describe, expect, it } from "vitest";
import { RedirectSearch } from "../../src/route/-redirect.js";

describe("RedirectSearch", () => {
  it("accepts a rooted path and hands it back", () => {
    const search = RedirectSearch.schema.parse({ redirect: "/invitation/abc123" });

    expect(RedirectSearch.target(search)).toBe("/invitation/abc123");
  });

  it("defaults to the home page when nothing was asked for", () => {
    expect(RedirectSearch.target(RedirectSearch.schema.parse({}))).toBe("/");
  });

  // Each of these leaves this origin once a browser resolves it. Rejecting them at the
  // schema is what keeps `/sign-in?redirect=` from being an open redirect.
  it.each([
    "//evil.test/path",
    "https://evil.test",
    "javascript:alert(1)",
    "evil.test",
    // A backslash is a path separator to every browser, so `/\evil.test` resolves with
    // `evil.test` as the host exactly as `//evil.test` does.
    "/\\evil.test",
    "/settings\\@evil.test",
  ])("rejects %s", (redirect) => {
    expect(() => RedirectSearch.schema.parse({ redirect })).toThrow();
  });
});
