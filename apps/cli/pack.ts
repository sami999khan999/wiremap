import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// Writes `dist/npm/`, the npm package `wiremap`, from the built `dist/`. The
// workspace name stays `@loadbearing/cli`: the repository root already holds `wiremap`.
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "npm");
const manifest = JSON.parse(await readFile(join(here, "package.json"), "utf8")) as {
  version: string;
  description: string;
  dependencies: Record<string, string>;
};
const workspace = parse(await readFile(join(here, "../../pnpm-workspace.yaml"), "utf8")) as {
  catalog: Record<string, string>;
};

// `catalog:` means nothing outside this workspace, so each one becomes the catalog's range.
const dependencies = Object.fromEntries(
  Object.entries(manifest.dependencies).map(([name, range]) => {
    const resolved = range === "catalog:" ? workspace.catalog[name] : range;
    if (!resolved) throw new Error(`${name} is not in the catalog`);
    return [name, resolved];
  }),
);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ["index.js", "tree-sitter-php.wasm"]) {
  await copyFile(join(here, "dist", file), join(out, file));
}
await copyFile(join(here, "README.md"), join(out, "README.md"));
await writeFile(
  join(out, "package.json"),
  `${JSON.stringify(
    {
      name: "wiremap",
      version: manifest.version,
      description: manifest.description,
      type: "module",
      bin: { wiremap: "./index.js" },
      files: ["index.js", "tree-sitter-php.wasm", "README.md"],
      engines: { node: ">=22" },
      // Proprietary until the owner chooses a licence; see docs/plans/TESTS.md.
      license: "UNLICENSED",
      repository: { type: "git", url: "git+https://github.com/sami999khan999/wiremap.git" },
      keywords: ["dependency-graph", "architecture", "nestjs", "nextjs", "laravel", "mcp"],
      dependencies,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`wrote ${out}\n`);
