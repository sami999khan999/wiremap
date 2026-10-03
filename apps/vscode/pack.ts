import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Stages `dist/extension/` for `vsce package`: the manifest without the workspace's
// `catalog:` and `workspace:` ranges, which vsce reads as semver and rejects, and the bundle.
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "extension");
const {
  devDependencies: _dev,
  scripts: _scripts,
  private: _private,
  type: _type,
  ...manifest
} = JSON.parse(await readFile(join(here, "package.json"), "utf8")) as Record<string, unknown>;

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "dist"), { recursive: true });
await copyFile(join(here, "dist", "main.cjs"), join(out, "dist", "main.cjs"));
await copyFile(join(here, "README.md"), join(out, "README.md"));
await writeFile(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(out, ".vscodeignore"), "*.vsix\n");
process.stdout.write(`staged ${out}\n`);
