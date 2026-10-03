import { describe, expect, it } from "vitest";
import { Glob } from "../src/walk/index.js";

describe("Glob", () => {
  it("matches a bare name anywhere, an anchored path from the root, and stars", () => {
    expect(new Glob("node_modules").matches("a/node_modules", true)).toBe(true);
    expect(new Glob("/dist").matches("dist", true)).toBe(true);
    expect(new Glob("/dist").matches("pkg/dist", true)).toBe(false);
    expect(new Glob("*.log").matches("logs/a.log", false)).toBe(true);
    expect(new Glob("src/*.gen.ts").matches("src/a.gen.ts", false)).toBe(true);
    expect(new Glob("src/*.gen.ts").matches("src/x/a.gen.ts", false)).toBe(false);
    expect(new Glob("**/fixtures").matches("fixtures", true)).toBe(true);
    expect(new Glob("**/fixtures").matches("a/b/fixtures", true)).toBe(true);
    expect(new Glob("build/").matches("build", false)).toBe(false);
    expect(new Glob("build/").matches("app/build", true)).toBe(true);
  });
});
