import { ServerOnlyError } from "@loadbearing/errors";
import { afterEach, describe, expect, it } from "vitest";
import { ServerOnly } from "../../src/primitive/server-only.js";

const global_ = globalThis as { window?: unknown };

afterEach(() => {
  delete global_.window;
});

describe("ServerOnly", () => {
  it("is silent on a server, where there is no window", () => {
    expect(() => {
      ServerOnly.assert("@loadbearing/infrastructure");
    }).not.toThrow();
  });

  it("throws a ServerOnlyError when a window exists", () => {
    global_.window = {};

    expect(() => {
      ServerOnly.assert("@loadbearing/infrastructure");
    }).toThrow(ServerOnlyError);
  });

  // Why this routes through `errors`: a boundary switches on the code and `content`
  // supplies the sentence. Prose coming back into the message fails here.
  it("carries a code and the package name, and no prose at all", () => {
    global_.window = {};

    try {
      ServerOnly.assert("@loadbearing/auth");
      expect.unreachable("assert should have thrown");
    } catch (thrown) {
      const error = thrown as ServerOnlyError;

      expect(error.code).toBe("SERVER_ONLY");
      expect(error.message).toBe("SERVER_ONLY");
      expect(error.context).toEqual({ package: "@loadbearing/auth" });
    }
  });

  // `globalThis.window` reached as an optional property — never a bare `window`.
  it("treats an explicitly undefined window as absent", () => {
    global_.window = undefined;

    expect(() => {
      ServerOnly.assert("@loadbearing/composition");
    }).not.toThrow();
  });
});
