// One `biome check` per chunk of staged paths, rather than one invocation carrying all of
// them. See docs/setup/26 — the limit this exists for is Windows', not Biome's.
const CHUNK = 40;

export default {
  // `mjs` and `cjs` included: every script in `tooling/scripts/` is `.mjs`, and the glob
  // without them meant `pnpm lint` caught their formatting and the hook never did.
  "*.{js,cjs,mjs,jsx,ts,tsx,json,jsonc,css}": (files) => {
    const commands = [];

    for (let index = 0; index < files.length; index += CHUNK) {
      const batch = files.slice(index, index + CHUNK).map((file) => JSON.stringify(file));
      commands.push(`biome check --write --no-errors-on-unmatched ${batch.join(" ")}`);
    }

    return commands;
  },
};
