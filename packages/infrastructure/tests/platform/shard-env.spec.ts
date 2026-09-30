import { afterEach, describe, expect, it, vi } from "vitest";
import { shardUrls } from "../../shard-env.js";

// `vi.stubEnv` rather than writing `process.env`: this spec would otherwise be the one
// file in `tests/` on the allowlist that lets a file read the environment directly.
const OWNED = [
  "DATABASE_URL",
  "DATABASE_DIRECT_URL",
  "DATABASE_SHARD_0_URL",
  "DATABASE_SHARD_1_URL",
  "DATABASE_SHARD_1_DIRECT_URL",
  "DATABASE_SHARD_2_URL",
  "DATABASE_SHARD_2_DIRECT_URL",
  "DATABASE_SHARD_3_URL",
];

// Cleared, not merely overwritten: this suite loads the root `.env`, which already sets
// `DATABASE_SHARD_1_URL` on a machine running the sharded profile.
const envWith = (values: Readonly<Record<string, string>>) => {
  for (const name of OWNED) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const NODE_0 = "postgres://node0/app";
const NODE_1 = "postgres://node1/app";
const NODE_2 = "postgres://node2/app";

describe("shardUrls", () => {
  it("refuses to guess when there is no catalog to start from", () => {
    envWith({});

    expect(() => shardUrls()).toThrow("DATABASE_URL is required.");
  });

  // The shape of every deployment until the split, and the one this repository ships.
  it("is one node when nothing names a shard", () => {
    envWith({ DATABASE_URL: NODE_0 });

    expect(shardUrls()).toEqual([{ url: NODE_0, directUrl: NODE_0 }]);
  });

  // Node 0 leads, which is what `pnpm db:migrate` relies on: the catalog carries the
  // tables every other node's schema is generated from.
  it("puts the catalog first and the shards after it in index order", () => {
    envWith({ DATABASE_URL: NODE_0, DATABASE_SHARD_2_URL: NODE_2, DATABASE_SHARD_1_URL: NODE_1 });

    expect(shardUrls().map((node) => node.url)).toEqual([NODE_0, NODE_1, NODE_2]);
  });

  it("falls back to the pooled url when a node names no direct one", () => {
    envWith({
      DATABASE_URL: NODE_0,
      DATABASE_DIRECT_URL: "postgres://node0-direct/app",
      DATABASE_SHARD_1_URL: NODE_1,
    });

    expect(shardUrls()).toEqual([
      { url: NODE_0, directUrl: "postgres://node0-direct/app" },
      { url: NODE_1, directUrl: NODE_1 },
    ]);
  });

  it("uses a node's own direct url when it has one", () => {
    envWith({
      DATABASE_URL: NODE_0,
      DATABASE_SHARD_1_URL: NODE_1,
      DATABASE_SHARD_1_DIRECT_URL: "postgres://node1-direct/app",
    });

    expect(shardUrls()[1]).toEqual({ url: NODE_1, directUrl: "postgres://node1-direct/app" });
  });

  // The failure the check exists for: the cluster indexes this array, so node 3 landing
  // at index 2 sends every tenant on it to the wrong database, silently.
  it("refuses a gap rather than closing it", () => {
    envWith({ DATABASE_URL: NODE_0, DATABASE_SHARD_1_URL: NODE_1, DATABASE_SHARD_3_URL: NODE_2 });

    expect(() => shardUrls()).toThrow("DATABASE_SHARD_3_URL has no shard 2 before it.");
  });

  it("refuses a shard that starts above one", () => {
    envWith({ DATABASE_URL: NODE_0, DATABASE_SHARD_2_URL: NODE_2 });

    expect(() => shardUrls()).toThrow("DATABASE_SHARD_2_URL has no shard 1 before it.");
  });

  // A commented-out line in `.env` leaves the name set and empty. The old reader stopped
  // its walk here and then failed the orphan scan, naming shard 1 as its own gap.
  it("reads an empty value as absent, the way both apps do", () => {
    envWith({ DATABASE_URL: NODE_0, DATABASE_SHARD_1_URL: "" });

    expect(shardUrls()).toEqual([{ url: NODE_0, directUrl: NODE_0 }]);
  });

  // Two names for one pool, and a disagreement about which is the catalog.
  it("ignores a shard numbered zero rather than listing the catalog twice", () => {
    envWith({ DATABASE_URL: NODE_0, DATABASE_SHARD_0_URL: NODE_1 });

    expect(shardUrls()).toEqual([{ url: NODE_0, directUrl: NODE_0 }]);
  });
});
