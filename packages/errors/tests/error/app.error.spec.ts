import { describe, expect, it } from "vitest";
import { ERROR_CATALOG, type ErrorCode } from "../../src/catalog/index.js";
import { AppError } from "../../src/error/app.error.js";
import { ForbiddenError } from "../../src/error/forbidden.error.js";
import { NotFoundError } from "../../src/error/not-found.error.js";
import { ValidationError } from "../../src/error/validation.error.js";
import { HTTP_STATUS } from "../../src/transport/http.js";
import { TraceIds } from "../../src/transport/trace-id.js";

describe("AppError", () => {
  // The rule the whole package is built on. If a message string ever appears
  // here, user-facing text has escaped `@loadbearing/content` and translation.
  it("carries the code as its message and no prose", () => {
    const error = new ForbiddenError("task.reactivate");

    expect(error.message).toBe("FORBIDDEN");
    expect(error.name).toBe("ForbiddenError");
  });

  it("carries structured context instead of an interpolated sentence", () => {
    expect(new ForbiddenError("task.reactivate", "goal-1").context).toEqual({
      permission: "task.reactivate",
      goalId: "goal-1",
    });
    expect(new ForbiddenError("task.reactivate").context).toEqual({
      permission: "task.reactivate",
    });
  });

  it("is a real Error, so it can be thrown and caught", () => {
    expect(() => {
      throw new NotFoundError("Task", "abc");
    }).toThrow();
  });

  it("exposes retryability from the catalog rather than restating it", () => {
    expect(new ForbiddenError("x").retryable).toBe(false);
  });

  describe("isKnownCode", () => {
    it("accepts a code the catalog defines and rejects one it does not", () => {
      expect(AppError.isKnownCode("FORBIDDEN")).toBe(true);
      expect(AppError.isKnownCode("FROBIDDEN")).toBe(false);
    });

    // Same prototype-chain hazard `PermissionRegistry.isKnown` closes.
    it("does not mistake an inherited object property for a code", () => {
      expect(AppError.isKnownCode("constructor")).toBe(false);
      expect(AppError.isKnownCode("toString")).toBe(false);
    });
  });

  describe("round-trip", () => {
    it("reconstructs code, context and fields from an envelope", () => {
      const original = new ValidationError([
        { field: "reason", rule: "tooShort", params: { min: 10 } },
      ]);
      const revived = AppError.from(JSON.parse(JSON.stringify(original.toJSON())));

      expect(revived?.code).toBe("BAD_REQUEST");
      expect(revived?.fields).toEqual([{ field: "reason", rule: "tooShort", params: { min: 10 } }]);
    });

    it("rejects an envelope naming a code it does not know", () => {
      expect(AppError.from({ code: "MADE_UP" as ErrorCode, context: {} })).toBeNull();
    });

    it("omits `fields` entirely when there are none", () => {
      expect(new ForbiddenError("x").toJSON()).not.toHaveProperty("fields");
    });
  });
});

describe("catalog and transport coverage", () => {
  it("gives every code an HTTP status", () => {
    for (const code of Object.keys(ERROR_CATALOG) as ErrorCode[]) {
      expect(HTTP_STATUS[code], code).toBeTypeOf("number");
    }
  });

  it("has not drifted between the catalog and the status map", () => {
    expect(Object.keys(HTTP_STATUS).sort()).toEqual(Object.keys(ERROR_CATALOG).sort());
  });
});

describe("traceId", () => {
  it("survives the round trip, so a user can quote it back", () => {
    const rebuilt = AppError.from({ code: "INTERNAL", context: {}, traceId: "t-1" });
    expect(rebuilt?.toJSON().traceId).toBe("t-1");
  });

  it("is absent when the server did not stamp one", () => {
    const rebuilt = AppError.from({ code: "INTERNAL", context: {} });
    expect(rebuilt?.toJSON()).not.toHaveProperty("traceId");
  });

  it("is never invented by a server-thrown error", () => {
    // The id belongs to the request, not to the failure. The adapter stamps it.
    expect(new ForbiddenError("task.read").toJSON()).not.toHaveProperty("traceId");
  });

  // The envelope arrives from the network and this value then rides every log line that
  // mentions the error, so `from()` checks it rather than adopting whatever was sent.
  it("drops a trace id that is not shaped like one", () => {
    for (const sent of ['" or 1=1 --', "a\nlevel=error", "spaces here", "\u0000", "  "]) {
      const rebuilt = AppError.from({ code: "INTERNAL", context: {}, traceId: sent });
      expect(rebuilt?.toJSON()).not.toHaveProperty("traceId");
    }
  });

  it("truncates one that is merely too long", () => {
    const rebuilt = AppError.from({ code: "INTERNAL", context: {}, traceId: "a".repeat(500) });

    // Truncated rather than dropped: an over-long id is still probably the upstream's,
    // and half a trace is more use than none.
    expect(rebuilt?.toJSON().traceId).toHaveLength(TraceIds.MAX_LENGTH);
  });
});
