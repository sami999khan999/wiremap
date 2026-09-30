import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/error/validation.error.js";
import { ErrorNormalizer } from "../../src/normalizer/error-normalizer.js";

// Shaped like a real `ZodError` without depending on zod — which is also how
// `ErrorNormalizer` recognises one, so this exercises the actual path.
const zodLike = (issues: readonly Record<string, unknown>[]) => ({ issues });

describe("ValidationError", () => {
  it("turns issues into field + rule + params", () => {
    const error = ValidationError.fromIssues([
      { path: ["reason"], code: "too_small", minimum: 10 },
      { path: ["title"], code: "invalid_type" },
    ]);

    expect(error.code).toBe("BAD_REQUEST");
    expect(error.fields).toEqual([
      { field: "reason", rule: "tooShort", params: { min: 10 } },
      { field: "title", rule: "required" },
    ]);
  });

  // The regression guard: the first bound found returned early, so a `min().max()`
  // issue lost `max` and `error.field.tooLong` rendered the placeholder.
  it("keeps both bounds when an issue carries both", () => {
    const error = ValidationError.fromIssues([
      { path: ["password"], code: "too_big", minimum: 8, maximum: 64 },
    ]);

    expect(error.fields?.[0]?.params).toEqual({ min: 8, max: 64 });
  });

  it("carries a maximum on its own", () => {
    const error = ValidationError.fromIssues([{ path: ["name"], code: "too_big", maximum: 120 }]);

    expect(error.fields?.[0]).toEqual({ field: "name", rule: "tooLong", params: { max: 120 } });
  });

  it("joins a nested path into a field name", () => {
    const error = ValidationError.fromIssues([
      { path: ["assignee", "email"], code: "invalid_format" },
    ]);

    expect(error.fields?.[0]?.field).toBe("assignee.email");
  });

  // Zod's own message must not survive into the envelope: `content` renders the
  // sentence from the rule name instead.
  it("discards the library's default message", () => {
    const thrown = zodLike([
      {
        path: ["reason"],
        code: "too_small",
        minimum: 10,
        message: "String must contain at least 10 character(s)",
      },
    ]);
    const envelope = ErrorNormalizer.normalize(thrown).toJSON();

    expect(JSON.stringify(envelope)).not.toContain("String must contain");
    expect(JSON.stringify(envelope)).not.toContain("character(s)");
    expect(envelope.fields).toEqual([{ field: "reason", rule: "tooShort", params: { min: 10 } }]);
  });

  // Zod issue codes are an open set; an unknown one must not leak as a rule name.
  it("maps an unrecognised issue code to a generic rule", () => {
    const error = ValidationError.fromIssues([{ path: ["x"], code: "some_future_zod_code" }]);

    expect(error.fields?.[0]?.rule).toBe("invalid");
  });

  it("normalises a zod-shaped throw without any zod import", () => {
    const normalized = ErrorNormalizer.normalize(zodLike([{ path: ["a"], code: "invalid_type" }]));

    expect(normalized.code).toBe("BAD_REQUEST");
  });
});
