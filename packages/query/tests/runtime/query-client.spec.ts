import type { ApiClient } from "@loadbearing/api-client";
import { ForbiddenError, UnavailableError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "../../src/runtime/query-client.js";

const transport = {} as ApiClient;

const retryOf = (staleTimeMs?: number) => {
  const { queryClient } = createQueryClient(
    staleTimeMs === undefined ? { transport } : { transport, staleTimeMs },
  );
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("retry should be a predicate");
  return retry;
};

describe("createQueryClient", () => {
  it("hands back the transport it was given, not one it built", () => {
    // A constructed `ApiClient`, never a base URL — that is what lets the server pass
    // an in-process transport and the browser an HTTP one.
    expect(createQueryClient({ transport }).apiClient).toBe(transport);
  });

  it("returns a fresh QueryClient on every call", () => {
    // The whole reason this is a factory. One instance in a server bundle is shared
    // across concurrent requests, which is a cross-tenant leak, not a caching bug.
    const first = createQueryClient({ transport }).queryClient;
    const second = createQueryClient({ transport }).queryClient;

    expect(first).not.toBe(second);
  });

  it("defaults staleTime to 30s and takes an override", () => {
    expect(
      createQueryClient({ transport }).queryClient.getDefaultOptions().queries?.staleTime,
    ).toBe(30_000);
    expect(
      createQueryClient({ transport, staleTimeMs: 0 }).queryClient.getDefaultOptions().queries
        ?.staleTime,
    ).toBe(0);
  });

  it("does not refetch on window focus", () => {
    // Every refetch here is an authenticated round trip carrying a capability
    // resolution. Freshness is opt-in per query.
    expect(
      createQueryClient({ transport }).queryClient.getDefaultOptions().queries
        ?.refetchOnWindowFocus,
    ).toBe(false);
  });

  it("never retries a mutation", () => {
    expect(createQueryClient({ transport }).queryClient.getDefaultOptions().mutations?.retry).toBe(
      false,
    );
  });
});

describe("the retry predicate", () => {
  it("refuses to retry a permission failure", () => {
    // Retrying FORBIDDEN twice with backoff turns an instant "you cannot do that" into
    // a three-second wait for the same answer, and triples the load from a stuck client.
    expect(retryOf()(0, new ForbiddenError("task.reactivate"))).toBe(false);
  });

  it("retries a retryable code, twice at most", () => {
    const retry = retryOf();
    const error = new UnavailableError("openai");

    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
  });

  // The catalog is the single source of the retryable fact, and an unknown throw
  // normalises to INTERNAL — which is not retryable.
  it("normalises an unknown throw before consulting the catalog", () => {
    expect(retryOf()(0, new Error("something from a library"))).toBe(false);
    // Cast because the predicate is typed `Error` and nothing enforces that at runtime,
    // which is the case this asserts.
    expect(retryOf()(0, "a string nobody should have thrown" as unknown as Error)).toBe(false);
  });
});
