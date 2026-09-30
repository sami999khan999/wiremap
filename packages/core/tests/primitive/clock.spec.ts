import { describe, expect, it } from "vitest";
import { FixedClock } from "../../src/primitive/clock.js";

describe("FixedClock", () => {
  it("returns the fixed instant", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(new FixedClock(at).now()).toEqual(at);
  });

  it("advances without mutating", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    const later = clock.advance(60_000);

    expect(later.now().toISOString()).toBe("2026-01-01T00:01:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
