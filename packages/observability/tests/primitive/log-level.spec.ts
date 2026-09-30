import { describe, expect, it } from "vitest";
import { LogLevels } from "../../src/primitive/log-level.js";

describe("LogLevels", () => {
  it("narrows an untrusted string", () => {
    expect(LogLevels.is("warn")).toBe(true);
    expect(LogLevels.is("WARN")).toBe(false);
    expect(LogLevels.is("verbose")).toBe(false);
    expect(LogLevels.is(undefined)).toBe(false);
    expect(LogLevels.is(null)).toBe(false);
  });

  it("orders levels", () => {
    expect(LogLevels.atLeast("error", "warn")).toBe(true);
    expect(LogLevels.atLeast("warn", "warn")).toBe(true);
    expect(LogLevels.atLeast("info", "warn")).toBe(false);
  });

  it("maps severity to a level — the first consumer ErrorMeta.severity has had", () => {
    // "someone tried what they cannot do" versus "we are broken". Only one pages.
    expect(LogLevels.fromSeverity("expected")).toBe("warn");
    expect(LogLevels.fromSeverity("unexpected")).toBe("error");
  });
});
