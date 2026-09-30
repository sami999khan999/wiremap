import { queryOptions } from "@tanstack/react-query";
import { describe, expect, expectTypeOf, it } from "vitest";
import { useAppQuery } from "../../src/runtime/use-app-query.js";

describe("useAppQuery", () => {
  it("is a function taking the object queryOptions produces", () => {
    // A pass-through by design, so `feature` can read through a defined query without
    // naming the cache library.
    expect(typeof useAppQuery).toBe("function");
    expect(useAppQuery.length).toBe(1);
  });

  it("preserves the data type queryOptions carries", () => {
    // The whole risk in a wrapper: a defaulted parameter or a widened signature breaks
    // inference silently, and every call site quietly becomes `unknown`.
    const options = queryOptions({
      queryKey: ["probe"] as const,
      queryFn: () => Promise.resolve({ id: "a", count: 1 }),
    });

    // Stated as "what `queryOptions` produces is accepted here", which is the direction
    // the call sites depend on. The reverse reads the same and is not true of either.
    expectTypeOf(options).toExtend<
      Parameters<
        typeof useAppQuery<
          { id: string; count: number },
          Error,
          { id: string; count: number },
          readonly ["probe"]
        >
      >[0]
    >();
  });

  it("returns a result narrowed to the query's data", () => {
    const result = {} as ReturnType<
      typeof useAppQuery<{ id: string }, Error, { id: string }, readonly ["probe"]>
    >;

    expectTypeOf(result.data).toEqualTypeOf<{ id: string } | undefined>();
  });
});
