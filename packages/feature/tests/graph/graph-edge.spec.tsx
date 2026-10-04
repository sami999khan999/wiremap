import { describe, expect, it } from "vitest";
import { routePath } from "../../src/graph/graph-edge.js";

describe("routePath", () => {
  it("draws a straight route as one line", () => {
    expect(
      routePath([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ]),
    ).toBe("M 0 0 L 50 0");
  });

  it("rounds a bend instead of drawing a sharp corner", () => {
    expect(
      routePath([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
      ]),
    ).toBe("M 0 0 L 32 0 Q 40 0 40 8 L 40 40");
  });
});
