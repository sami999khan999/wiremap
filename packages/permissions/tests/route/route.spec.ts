import { describe, expect, it } from "vitest";
import { GATES } from "../../src/gate/index.js";
import { ROUTES } from "../../src/route/index.js";

const declaredPaths = (): string[] =>
  Object.values(ROUTES).flatMap((group) => Object.values<string>(group));

describe("ROUTES", () => {
  it("merges every fragment into one table", () => {
    expect(ROUTES.rbac.roles).toBe("/settings/roles");
    expect(ROUTES.shell.signIn).toBe("/sign-in");
  });

  it("declares every path rooted", () => {
    for (const path of declaredPaths()) {
      expect(path.startsWith("/")).toBe(true);
    }
  });

  // The compiler already rejects a gate pointing at an undeclared path. This catches
  // what it cannot see: a path removed while a gate still names the same literal.
  it("declares a path for every gate", () => {
    const paths = declaredPaths();
    for (const gate of Object.values(GATES)) {
      expect(paths).toContain(gate.route);
    }
  });

  it("declares no path twice across fragments", () => {
    const paths = declaredPaths();
    expect(paths.length).toBe(new Set(paths).size);
  });
});
