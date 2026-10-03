import { nodePath, parseYaml, readdir, readFile } from "../import.js";

// One `package.json` in the repository: its folder (`""` at the root), the names it depends
// on, and the files it declares as entry points.
export interface PackageInfo {
  readonly dir: string;
  readonly name: string | null;
  readonly dependencies: ReadonlySet<string>;
  readonly entries: readonly string[];
}

// One `composer.json`: the PSR-4 map that turns a class name into a file, and what it requires.
export interface ComposerInfo {
  readonly dir: string;
  readonly psr4: readonly (readonly [prefix: string, dir: string])[];
  readonly require: ReadonlySet<string>;
}

export interface RepositoryLayout {
  readonly packages: readonly PackageInfo[];
  readonly composers: readonly ComposerInfo[];
}

type Json = Record<string, unknown>;

// Reads the workspace shape: npm and yarn `workspaces`, `pnpm-workspace.yaml`, and composer's
// root plus its `path` repositories. Anything unreadable is skipped, never fatal.
export class RepositoryLayoutReader {
  private constructor() {}

  public static async read(root: string): Promise<RepositoryLayout> {
    const rootPackage = await RepositoryLayoutReader.json(nodePath.join(root, "package.json"));
    const patterns = new Set<string>();
    const workspaces = rootPackage?.workspaces;
    if (Array.isArray(workspaces)) for (const each of workspaces) patterns.add(String(each));
    if (
      workspaces &&
      typeof workspaces === "object" &&
      Array.isArray((workspaces as Json).packages)
    ) {
      for (const each of (workspaces as { packages: unknown[] }).packages)
        patterns.add(String(each));
    }
    const pnpm = await readFile(nodePath.join(root, "pnpm-workspace.yaml"), "utf8").catch(
      () => null,
    );
    if (pnpm) {
      const parsed = parseYaml(pnpm) as { packages?: unknown } | null;
      if (Array.isArray(parsed?.packages))
        for (const each of parsed.packages) patterns.add(String(each));
    }

    const dirs = new Set<string>([""]);
    for (const pattern of patterns) {
      if (pattern.startsWith("!")) continue;
      for (const dir of await RepositoryLayoutReader.expand(root, pattern)) dirs.add(dir);
    }

    const packages: PackageInfo[] = [];
    for (const dir of [...dirs].toSorted()) {
      const json = await RepositoryLayoutReader.json(nodePath.join(root, dir, "package.json"));
      if (json) packages.push(RepositoryLayoutReader.packageInfo(dir, json));
    }

    const composers: ComposerInfo[] = [];
    const rootComposer = await RepositoryLayoutReader.json(nodePath.join(root, "composer.json"));
    if (rootComposer) {
      composers.push(RepositoryLayoutReader.composerInfo("", rootComposer));
      const repositories = Array.isArray(rootComposer.repositories)
        ? rootComposer.repositories
        : [];
      for (const repository of repositories as Json[]) {
        if (repository?.type !== "path" || typeof repository.url !== "string") continue;
        for (const dir of await RepositoryLayoutReader.expand(
          root,
          repository.url.replace(/^\.\//, ""),
        )) {
          const json = await RepositoryLayoutReader.json(nodePath.join(root, dir, "composer.json"));
          if (json) composers.push(RepositoryLayoutReader.composerInfo(dir, json));
        }
      }
    }
    return { packages, composers };
  }

  // The package a file belongs to: the deepest folder that holds it.
  public static owner<T extends { readonly dir: string }>(
    items: readonly T[],
    local: string,
  ): T | undefined {
    let best: T | undefined;
    for (const item of items) {
      const inside = item.dir === "" || local === item.dir || local.startsWith(`${item.dir}/`);
      if (inside && (!best || item.dir.length > best.dir.length)) best = item;
    }
    return best;
  }

  private static packageInfo(dir: string, json: Json): PackageInfo {
    const dependencies = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = json[field];
      if (block && typeof block === "object")
        for (const name of Object.keys(block)) dependencies.add(name);
    }
    const entries = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === "string")
        entries.add(nodePath.posix.join(dir, value.replace(/^\.\//, "")));
      else if (value && typeof value === "object")
        for (const nested of Object.values(value)) add(nested);
    };
    add(json.main);
    add(json.module);
    add(json.bin);
    add(json.exports);
    return {
      dir,
      name: typeof json.name === "string" ? json.name : null,
      dependencies,
      entries: [...entries],
    };
  }

  private static composerInfo(dir: string, json: Json): ComposerInfo {
    const psr4: [string, string][] = [];
    for (const field of ["autoload", "autoload-dev"]) {
      const block = (json[field] as Json | undefined)?.["psr-4"];
      if (!block || typeof block !== "object") continue;
      for (const [prefix, target] of Object.entries(block as Json)) {
        for (const each of Array.isArray(target) ? target : [target]) {
          if (typeof each === "string") psr4.push([prefix, nodePath.posix.join(dir, each)]);
        }
      }
    }
    const require = new Set<string>();
    for (const field of ["require", "require-dev"]) {
      const block = json[field];
      if (block && typeof block === "object")
        for (const name of Object.keys(block)) require.add(name);
    }
    // Longest prefix first, so `App\Http\` wins over `App\`.
    return { dir, psr4: psr4.toSorted((a, b) => b[0].length - a[0].length), require };
  }

  // `packages/*` and `apps/**`: one level, or every folder below that holds a package file.
  private static async expand(root: string, pattern: string): Promise<string[]> {
    const clean = pattern.replace(/\/+$/, "");
    const star = clean.indexOf("*");
    if (star === -1) return [clean];
    const base = clean.slice(0, star).replace(/\/$/, "");
    const deep = clean.slice(star).startsWith("**");
    const found: string[] = [];
    const visit = async (dir: string, depth: number) => {
      const entries = await readdir(nodePath.join(root, dir), { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith("."))
          continue;
        const child = dir === "" ? entry.name : `${dir}/${entry.name}`;
        found.push(child);
        if (deep && depth < 4) await visit(child, depth + 1);
      }
    };
    await visit(base, 0);
    return found;
  }

  private static async json(file: string): Promise<Json | null> {
    try {
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      return value && typeof value === "object" ? (value as Json) : null;
    } catch {
      return null;
    }
  }
}
