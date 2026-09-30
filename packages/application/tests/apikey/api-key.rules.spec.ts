import { ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { ApiKeyRules } from "../../src/apikey/api-key.rules.js";

describe("ApiKeyRules.mint", () => {
  it("returns the token once and yields only a digest to store", async () => {
    const minted = await ApiKeyRules.mint();

    // The whole point of the split: what goes in the database is the hash, and it must
    // not be possible to get back to the token from either stored field.
    expect(minted.token).toMatch(/^rk_[0-9a-f]{64}$/);
    expect(minted.tokenHash).not.toContain(minted.token);
    expect(minted.token.startsWith(minted.prefix)).toBe(true);
  });

  it("never issues the same token twice", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 32 }, () => ApiKeyRules.mint().then((key) => key.token)),
    );

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  // The format is shared with `ApiKeyResolver` in `auth`, which authenticates what this
  // mints. Two copies of these two values would drift into a key that cannot be used.
  it("prefixes the token so a leak is greppable", () => {
    expect(ApiKeyRules.TOKEN_PREFIX).toBe("rk_");
    expect(ApiKeyRules.prefixOf("rk_0123456789abcdef")).toBe("rk_01234");
    expect(ApiKeyRules.prefixOf("rk_0123456789abcdef")).toHaveLength(ApiKeyRules.PREFIX_LENGTH);
  });
});

describe("ApiKeyRules.assertKnownScopes", () => {
  it("passes scopes the catalog knows", () => {
    expect(ApiKeyRules.assertKnownScopes(["member.read", "rbac.role.read"])).toEqual([
      "member.read",
      "rbac.role.read",
    ]);
  });

  // A typo written into `scopes` would be a key that silently grants nothing, and no
  // error anywhere to say why the integration stopped working.
  it("refuses one it does not", () => {
    expect(() => ApiKeyRules.assertKnownScopes(["member.raed"])).toThrow(ValidationError);
  });
});
