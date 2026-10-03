import { nodePath, readdir, readFile, stat } from "../import.js";
import { Glob } from "./glob.js";

export interface WalkedFile {
  readonly local: string;
  readonly absolute: string;
}

// Every source file under a root, minus the ignore list and the root's `.gitignore`. Files
// over the size cap are skipped: at that size it is a bundle or generated, not source.
export class FileWalker {
  public static readonly EXTENSIONS = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".php",
  ];
  private static readonly MAX_BYTES = 1_000_000;
  // Never source, whatever the ignore list says.
  private static readonly ALWAYS = [".git", "node_modules", "vendor"];

  private constructor() {}

  public static walk(root: string, ignore: readonly string[]): Promise<WalkedFile[]> {
    return FileWalker.find(root, ignore, (name) => FileWalker.isSource(name));
  }

  // Any file the predicate accepts by name, under the same ignore rules and size cap.
  public static async find(
    root: string,
    ignore: readonly string[],
    accept: (name: string) => boolean,
  ): Promise<WalkedFile[]> {
    const gitignore = await readFile(nodePath.join(root, ".gitignore"), "utf8").catch(() => "");
    const globs = [
      ...[...FileWalker.ALWAYS, ...ignore].map((pattern) => new Glob(pattern)),
      ...Glob.fromGitignore(gitignore),
    ];
    const found: WalkedFile[] = [];
    const pending = [""];
    while (pending.length > 0) {
      const dir = pending.pop() as string;
      const entries = await readdir(nodePath.join(root, dir), { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        const local = dir === "" ? entry.name : `${dir}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!Glob.any(globs, local, true)) pending.push(local);
          continue;
        }
        if (!entry.isFile() || !accept(entry.name) || Glob.any(globs, local, false)) continue;
        const absolute = nodePath.join(root, local);
        const size = (await stat(absolute)).size;
        if (size <= FileWalker.MAX_BYTES) found.push({ local, absolute });
      }
    }
    return found.toSorted((a, b) => a.local.localeCompare(b.local));
  }

  public static isSource(name: string): boolean {
    if (name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return false;
    if (/\.min\.[cm]?js$/.test(name)) return false;
    return FileWalker.EXTENSIONS.some((extension) => name.endsWith(extension));
  }
}
