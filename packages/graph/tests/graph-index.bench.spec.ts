import { describe, expect, it } from "vitest";
import { GraphIndex, type GraphInput } from "../src/index.js";

// 20,000 files in 200 folders, five imports each, with a long chain through all of them:
// the chain is what would overflow a recursive Tarjan.
const generated = (count: number): GraphInput => {
  const files = Array.from({ length: count }, (_, i) => ({ path: `src/m${i % 200}/f${i}.ts` }));
  const edges: { from: string; to: string; kind: "import" }[] = [];
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  for (let i = 0; i < count; i += 1) {
    const from = files[i]?.path as string;
    if (i + 1 < count) edges.push({ from, to: files[i + 1]?.path as string, kind: "import" });
    for (let k = 0; k < 4; k += 1) {
      edges.push({ from, to: files[Math.floor(random() * count)]?.path as string, kind: "import" });
    }
  }
  return { files, edges };
};

describe("GraphIndex at 20,000 files", () => {
  it("builds, finds cycles, aggregates and ranks inside the budget", () => {
    const input = generated(20_000);
    const started = performance.now();
    const index = GraphIndex.from(input);
    const cycles = index.cycles();
    const folders = index.folders(2);
    const top = index.mostDepended(10);
    const impact = index.impact("src/m0/f0.ts");
    const elapsed = performance.now() - started;

    expect(index.size).toBe(20_000);
    expect(cycles.length).toBeGreaterThan(0);
    expect(folders.nodes).toHaveLength(200);
    expect(top).toHaveLength(10);
    expect(impact.length).toBeGreaterThan(0);
    // Generous for a loaded CI runner; locally this is a few hundred milliseconds.
    expect(elapsed).toBeLessThan(3_000);
  });
});
