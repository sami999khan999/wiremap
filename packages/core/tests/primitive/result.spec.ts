import { describe, expect, it } from "vitest";
import { Err, Ok, type Result, Results } from "../../src/primitive/result.js";

describe("Results", () => {
  it("builds the ok case", () => {
    const result = Results.ok<number, string>(1);

    expect(result.kind).toBe("ok");
    expect(result.unwrapOr(0)).toBe(1);
  });

  it("builds the err case", () => {
    const result = Results.err<string, number>("nope");

    expect(result.kind).toBe("err");
    expect(result.unwrapOr(0)).toBe(0);
  });
});

describe("mapOk / mapErr", () => {
  it("transforms only the matching side", () => {
    expect(
      Results.ok<number, string>(1)
        .mapOk((n) => n + 1)
        .unwrapOr(0),
    ).toBe(2);

    expect(
      Results.err<string, number>("nope")
        .mapOk((n) => n + 1)
        .unwrapOr(0),
    ).toBe(0);
  });

  it("passes the other side through untouched", () => {
    const mapped = Results.err<string, number>("nope").mapErr((e) => e.toUpperCase());

    expect(mapped.kind).toBe("err");
    expect(mapped instanceof Err && mapped.error).toBe("NOPE");
  });
});

// Compile-time assertions as much as runtime ones: `tests/` is inside the tsconfig
// `include`, so a narrowing regression fails `pnpm typecheck` before any test runs.
describe("narrowing", () => {
  const widen = (r: Result<number, string>): Result<number, string> => r;

  it("narrows both branches of an if/else", () => {
    const result = widen(Results.ok(1));

    if (result.kind === "ok") {
      const value: number = result.value;
      expect(value).toBe(1);
    } else {
      const error: string = result.error;
      expect.unreachable(error);
    }
  });

  it("narrows the fall-through after an early return", () => {
    const first = (r: Result<number, string>): number => {
      if (r.kind === "err") {
        return -1;
      }
      return r.value;
    };

    expect(first(widen(Results.ok(7)))).toBe(7);
    expect(first(widen(Results.err("nope")))).toBe(-1);
  });

  it("narrows on instanceof, including the negative branch", () => {
    const result = widen(Results.err("nope"));

    if (result instanceof Ok) {
      expect.unreachable(String(result.value));
    }

    const error: string = result.error;
    expect(error).toBe("nope");
  });

  it("switches exhaustively with no default arm", () => {
    const describeIt = (r: Result<number, string>): string => {
      switch (r.kind) {
        case "ok":
          return `ok:${r.value}`;
        case "err":
          return `err:${r.error}`;
      }
    };

    expect(describeIt(widen(Results.ok(1)))).toBe("ok:1");
    expect(describeIt(widen(Results.err("nope")))).toBe("err:nope");
  });
});
