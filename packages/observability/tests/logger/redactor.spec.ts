import { describe, expect, it } from "vitest";
import { REDACTED, Redactor } from "../../src/logger/redactor.js";

describe("Redactor", () => {
  it("matches on a substring, in any casing or separator", () => {
    for (const name of [
      "token",
      "userToken",
      "refresh_token",
      "x-api-key",
      "apiKey",
      "Authorization",
      "sessionId",
      "PASSWORD",
      "privateKey",
      "clientSecret",
      "cookie",
    ]) {
      expect(Redactor.isSensitive(name)).toBe(true);
    }
  });

  it("leaves ordinary fields alone", () => {
    for (const name of ["path", "status", "durationMs", "queue", "jobId", "userId", "traceId"]) {
      expect(Redactor.isSensitive(name)).toBe(false);
    }
  });

  it("replaces the value, keeping the key so the shape is stable", () => {
    expect(Redactor.apply({ path: "/x", token: "abc" })).toEqual({
      path: "/x",
      token: REDACTED,
    });
  });

  it("returns the original object when there is nothing to redact", () => {
    // This runs on every line the process emits; the common case allocates nothing.
    const fields = { path: "/x", status: 200 };
    expect(Redactor.apply(fields)).toBe(fields);
  });
});
