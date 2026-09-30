import { describe, expect, it } from "vitest";
import { BetterAuthErrorNormalizer } from "../../src/auth/better-auth-error-normalizer.js";

// `ErrorNormalizer` flattens anything that is not an `AppError` to `INTERNAL`, so a bare
// `Error` here makes every branch a caller writes on a code unreachable.
const codeOf = (error: unknown) => BetterAuthErrorNormalizer.normalize(error as never).code;

describe("BetterAuthErrorNormalizer — mapped codes", () => {
  it("turns an existing account into CONFLICT", () => {
    expect(codeOf({ code: "USER_ALREADY_EXISTS", status: 422 })).toBe("CONFLICT");
    expect(codeOf({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 })).toBe("CONFLICT");
  });

  // One rule for every way a token can be unusable: three sentences for one recovery is
  // three chances to word one of them wrongly.
  it("collapses every unusable token into one field violation", () => {
    for (const code of ["INVALID_TOKEN", "TOKEN_EXPIRED", "INVALID_OR_EXPIRED_TOKEN"]) {
      const error = BetterAuthErrorNormalizer.normalize({ code, status: 400 } as never);

      expect(error.code).toBe("BAD_REQUEST");
      expect(error.fields).toEqual([{ field: "token", rule: "invalid" }]);
    }
  });

  it("reports a rejected password against the field that caused it", () => {
    const error = BetterAuthErrorNormalizer.normalize({
      code: "PASSWORD_TOO_SHORT",
      status: 400,
    } as never);

    expect(error.fields).toEqual([{ field: "password", rule: "tooShort" }]);
  });

  // A 403 would read as the generic refusal, and the person would retry a right password.
  it("turns the session hook's suspension into its own code", () => {
    expect(codeOf({ code: "ACCOUNT_SUSPENDED", status: 403 })).toBe("ACCOUNT_SUSPENDED");
  });

  // The mapped code wins over the status: `USER_ALREADY_EXISTS` is a 4xx that would
  // otherwise fall through to a validation error.
  it("prefers the code over the status when both are present", () => {
    expect(codeOf({ code: "USER_ALREADY_EXISTS", status: 400 })).toBe("CONFLICT");
  });

  // Their code is a string from outside, and the lookup was a bare index: `BY_CODE`
  // inherits `toString`, which is truthy and returns no `AppError` when called.
  it.each(["toString", "constructor", "valueOf"])(
    "does not mistake the inherited name %s for a mapped code",
    (code) => {
      expect(codeOf({ code, status: 429 })).toBe("RATE_LIMITED");
    },
  );
});

describe("BetterAuthErrorNormalizer — status fallback", () => {
  // The status, never the message: `error.message` is English prose that breaks at their
  // next release and in every locale but one.
  it("maps a throttled request onto the retryable code", () => {
    const error = BetterAuthErrorNormalizer.normalize({ status: 429 } as never);

    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
  });

  it("separates the two rejection statuses", () => {
    expect(codeOf({ status: 401 })).toBe("UNAUTHORIZED");
    // The regression guard: both mapped to UNAUTHORIZED, whose copy is "please sign in"
    // — advice that cannot help a signed-in user who simply may not.
    expect(codeOf({ status: 403 })).toBe("FORBIDDEN");
  });

  it("maps an unrecognised rejection onto BAD_REQUEST", () => {
    expect(codeOf({ status: 400 })).toBe("BAD_REQUEST");
  });

  // The other half: a violation with an empty `field` rendered as " is not valid.",
  // because every `error.field.*` template opens with `{field}`.
  it("names no field when it has none to name", () => {
    const error = BetterAuthErrorNormalizer.normalize({ status: 400 } as never);

    expect(error.fields).toEqual([]);
  });

  // Including `null` and `undefined` — the `!data` branch on every read in
  // `AccountClient` passes exactly that.
  it("maps everything it does not recognise onto INTERNAL", () => {
    expect(codeOf({ status: 500 })).toBe("INTERNAL");
    expect(codeOf({ code: "SOMETHING_NEW", status: 418 })).toBe("INTERNAL");
    expect(codeOf(null)).toBe("INTERNAL");
    expect(codeOf(undefined)).toBe("INTERNAL");
  });

  // Never prose, in any branch: `Error.message` *is* the code, so a smuggled sentence
  // puts untranslated English on screen wherever a caller renders it.
  it("never carries a message that is not the code", () => {
    const error = BetterAuthErrorNormalizer.normalize({
      status: 500,
      message: "Internal server error",
    } as never);

    expect(error.message).toBe("INTERNAL");
  });
});
