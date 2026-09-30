import { ForbiddenError, HTTP_STATUS, ValidationError } from "@loadbearing/errors";
import { SilentLogger } from "@loadbearing/observability";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { ErrorInterceptor } from "../../src/router/error.interceptor.js";

const TRACE = "trace-0123456789";

function thrownBy(value: unknown): ORPCError<string, unknown> {
  try {
    ErrorInterceptor.toTransport(value, new SilentLogger(), TRACE);
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }

  throw new Error("toTransport must never return.");
}

describe("ErrorInterceptor", () => {
  it("maps a domain error through the catalog rather than a local switch", () => {
    const error = thrownBy(new ForbiddenError("rbac.role.manage"));

    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("attaches the trace id to the envelope", () => {
    const data = thrownBy(new ForbiddenError("rbac.role.manage")).data as { traceId?: string };

    // The only thing that lets an error page show a reference string a support request
    // can quote, and the only way that string finds the exact log line.
    expect(data.traceId).toBe(TRACE);
  });

  it("normalises anything at all into an envelope rather than leaking it", () => {
    // A rejected string, a Postgres failure, a `TypeError`. None of them may reach a
    // client as themselves — the body is the envelope, never prose and never a stack.
    for (const value of ["boom", new TypeError("boom"), 42, null]) {
      const error = thrownBy(value);
      expect(error.code).toBe("INTERNAL");
      expect(error.status).toBe(HTTP_STATUS.INTERNAL);
      expect(JSON.stringify(error.data)).not.toContain("boom");
    }
  });

  it("carries field violations through for a validation failure", () => {
    const error = thrownBy(
      ValidationError.fromIssues([{ path: ["email"], code: "invalid_string" }]),
    );

    // `BAD_REQUEST`, not a `VALIDATION` code of its own: the catalog is closed, and a
    // schema failure is a malformed request. The detail lives in `fields`.
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect((error.data as { fields?: unknown }).fields).toBeDefined();
  });
});
