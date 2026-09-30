import { describe, expect, it } from "vitest";
import { ERROR_CATALOG } from "../../src/catalog/index.js";
import { ServerOnlyError } from "../../src/error/server-only.error.js";
import { ErrorNormalizer } from "../../src/normalizer/error-normalizer.js";

describe("ServerOnlyError", () => {
  it("carries the code as its message and the package as context", () => {
    const error = new ServerOnlyError("@loadbearing/infrastructure");

    expect(error.message).toBe("SERVER_ONLY");
    expect(error.name).toBe("ServerOnlyError");
    expect(error.context).toEqual({ package: "@loadbearing/infrastructure" });
  });

  // The context key is the placeholder name in `error.serverOnly`. Renaming it
  // here silently turns the rendered sentence back into `{package}`.
  it("names its context key `package`, matching the copy template", () => {
    expect(Object.keys(new ServerOnlyError("@loadbearing/auth").context)).toEqual(["package"]);
  });

  it("is not retryable — a build defect does not improve on a second attempt", () => {
    expect(new ServerOnlyError("@loadbearing/auth").retryable).toBe(false);
    expect(ERROR_CATALOG.SERVER_ONLY.severity).toBe("unexpected");
  });

  it("survives the normalizer as itself, so a boundary can still see the code", () => {
    const thrown = new ServerOnlyError("@loadbearing/composition");

    expect(ErrorNormalizer.normalize(thrown)).toBe(thrown);
  });

  it("serialises to a prose-free envelope", () => {
    const envelope = new ServerOnlyError("@loadbearing/infrastructure").toJSON();

    expect(envelope).toEqual({
      code: "SERVER_ONLY",
      context: { package: "@loadbearing/infrastructure" },
    });
    expect(JSON.stringify(envelope)).not.toMatch(/bundle|leak|browser/i);
  });
});
