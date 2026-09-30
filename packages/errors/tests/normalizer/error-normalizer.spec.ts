import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../src/error/forbidden.error.js";
import { ErrorNormalizer } from "../../src/normalizer/error-normalizer.js";

describe("ErrorNormalizer", () => {
  it("returns one of ours unchanged", () => {
    const original = new ForbiddenError("task.reactivate", "goal-1");

    expect(ErrorNormalizer.normalize(original)).toBe(original);
  });

  // The whole point of a normaliser: whatever arrives, the shape afterwards is
  // known. A `throw "boom"` and a rejected `undefined` are both real.
  it.each([
    ["an Error", new Error("connection to db-prod-01 refused")],
    ["a string", "boom"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a plain object", { nope: true }],
  ])("collapses %s to INTERNAL", (_label, thrown) => {
    const normalized = ErrorNormalizer.normalize(thrown);

    expect(normalized.code).toBe("INTERNAL");
    expect(normalized.toJSON().code).toBe("INTERNAL");
  });

  // This is the requirement, so it is asserted directly rather than inferred: a
  // Postgres error string names your tables, and it must not reach a client.
  it("keeps the original text out of the envelope entirely", () => {
    const secret = 'connection to db-prod-01 refused: relation "user_api_keys" does not exist';
    const normalized = ErrorNormalizer.normalize(new Error(secret));

    expect(JSON.stringify(normalized.toJSON())).not.toContain("db-prod-01");
    expect(JSON.stringify(normalized.toJSON())).not.toContain("user_api_keys");
    expect(JSON.stringify(normalized)).not.toContain("db-prod-01");
  });

  it("keeps the original reachable for a logger", () => {
    const cause = new Error("underlying");
    const normalized = ErrorNormalizer.normalize(cause);

    expect((normalized as { cause?: unknown }).cause).toBe(cause);
  });

  // Structural detection, not `instanceof` — two copies of the package in one
  // process give two class identities and `instanceof` answers `false`.
  it("recognises a structurally-identical error from another copy of the package", () => {
    const foreign = {
      code: "FORBIDDEN",
      context: { permission: "task.read" },
      toJSON: () => ({ code: "FORBIDDEN", context: { permission: "task.read" } }),
    };

    expect(ErrorNormalizer.normalize(foreign).code).toBe("FORBIDDEN");
  });

  it("does not mistake an unknown code for one of ours", () => {
    const foreign = { code: "TOTALLY_MADE_UP", context: {}, toJSON: () => ({}) };

    expect(ErrorNormalizer.normalize(foreign).code).toBe("INTERNAL");
  });

  // The shape a decoded oRPC error has on the client: a known `code` and a `toJSON` of
  // its own, with our envelope underneath in `data`. It passes the structural check.
  describe("a transport error carrying the envelope in `data`", () => {
    const decoded = (data: unknown) => ({
      defined: false,
      code: "CONFLICT",
      status: 409,
      message: "Conflict",
      data,
      toJSON: () => ({ defined: false, code: "CONFLICT", status: 409, message: "Conflict", data }),
    });

    // The bug this branch exists for: `context` arrived as `undefined`, and three
    // screens read `envelope.context.<x>` straight into a `TypeError`.
    it("rebuilds the context the transport wrapped", () => {
      const thrown = decoded({ code: "CONFLICT", context: { resource: "member", reason: "self" } });

      const envelope = ErrorNormalizer.normalize(thrown).toJSON();

      expect(envelope.code).toBe("CONFLICT");
      expect(envelope.context).toEqual({ resource: "member", reason: "self" });
    });

    it("rebuilds the field violations, so field-level copy can render", () => {
      const thrown = decoded({
        code: "BAD_REQUEST",
        context: {},
        fields: [{ field: "expiresAt", rule: "past" }],
      });

      expect(ErrorNormalizer.normalize(thrown).toJSON().fields).toEqual([
        { field: "expiresAt", rule: "past" },
      ]);
    });

    it("carries the trace id through", () => {
      const thrown = decoded({ code: "INTERNAL", context: {}, traceId: "0123456789abcdef" });

      expect(ErrorNormalizer.normalize(thrown).toJSON().traceId).toBe("0123456789abcdef");
    });

    // An envelope is untrusted input, so the wrapper's own code is never adopted: the
    // alternative is a client branching on a code the catalog does not hold.
    it("collapses to INTERNAL when the wrapped code is unknown", () => {
      const thrown = decoded({ code: "TOTALLY_MADE_UP", context: { reason: "self" } });

      expect(ErrorNormalizer.normalize(thrown).code).toBe("INTERNAL");
    });

    // `context` defaults to `{}` on the way back in, which is what stops the crash
    // when a server throws with no context at all.
    it("gives an absent context an empty object rather than undefined", () => {
      expect(ErrorNormalizer.normalize(decoded({ code: "FORBIDDEN" })).toJSON().context).toEqual(
        {},
      );
    });
  });

  // The branch runs before the structural check, so this is the regression it could
  // break: one of ours must still come back by identity, not rebuilt.
  it("still returns one of ours unchanged when it happens to carry `data`", () => {
    const original = new ForbiddenError("task.reactivate", "goal-1");
    (original as unknown as { data: unknown }).data = { nothing: "to do with the envelope" };

    expect(ErrorNormalizer.normalize(original)).toBe(original);
  });
});
