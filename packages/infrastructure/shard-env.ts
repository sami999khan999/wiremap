// The physical nodes, in index order, for the scripts above `src/`. A second reader of
// `DATABASE_SHARD_<n>_URL` beside each app's `env.ts`, and deliberately so: a script is
// the one category allowed to read the environment directly, and importing an app's
// `Env` from here would make `pnpm db:migrate` parse the web app's whole schema.

export interface ShardUrls {
  readonly url: string;
  readonly directUrl: string;
  // Read so the three copies stay one algorithm; no script dials a standby.
  readonly replicaUrl?: string;
}

// `DATABASE_SHARD_<n>_URL` in index order, each with an optional `_DIRECT_URL` and
// `_REPLICA_URL` beside it. Absent is one node, which is every deployment until the split.
const shardsFromEnv = (): readonly ShardUrls[] => {
  const found: { index: number; url: string; directUrl: string; replicaUrl?: string }[] = [];

  for (const [name, value] of Object.entries(process.env)) {
    const match = /^DATABASE_SHARD_(\d+)_URL$/.exec(name);
    if (!match?.[1] || !value) continue;

    const index = Number(match[1]);
    // Node 0 is `DATABASE_URL`; a `DATABASE_SHARD_0_URL` beside it would be two names
    // for one pool and a disagreement about which is the catalog.
    if (index < 1) continue;

    found.push({
      index,
      url: value,
      directUrl: process.env[`DATABASE_SHARD_${index}_DIRECT_URL`] ?? value,
      // `||`, not `??`: an empty value is "no standby", the way `.env.example` shows one.
      replicaUrl: process.env[`DATABASE_SHARD_${index}_REPLICA_URL`] || undefined,
    });
  }

  // Contiguity-checked: the cluster indexes this array, so a gap puts node 3 at
  // index 2 and resolves every tenant on it to the wrong database.
  const sorted = found.toSorted((left, right) => left.index - right.index);
  sorted.forEach((shard, at) => {
    if (shard.index !== at + 1) {
      throw new Error(`DATABASE_SHARD_${shard.index}_URL has no shard ${at + 1} before it.`);
    }
  });

  return sorted.map(({ url, directUrl, replicaUrl }) => ({ url, directUrl, replicaUrl }));
};

// Node 0 is `DATABASE_URL` and is on the front of this list, where each app's `Env`
// leaves it off: a script walks every node, and `Container` builds node 0 separately.
export const shardUrls = (): readonly ShardUrls[] => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");

  return [{ url, directUrl: process.env.DATABASE_DIRECT_URL ?? url }, ...shardsFromEnv()];
};
