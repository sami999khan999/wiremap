import { nodePath } from "../import.js";
import type { ComposerInfo } from "../workspace/index.js";
import type { Resolution } from "./resolution.js";

// A class name to its file through composer's PSR-4 map, or a `require` path to a file. A
// name under no mapped prefix belongs to a vendor package, which coverage does not count.
export class PhpResolver {
  private readonly psr4: readonly (readonly [string, string])[];

  public constructor(
    private readonly files: ReadonlySet<string>,
    composers: readonly ComposerInfo[],
  ) {
    this.psr4 = composers
      .flatMap((composer) => composer.psr4)
      .toSorted((a, b) => b[0].length - a[0].length);
  }

  public resolve(from: string, specifier: string): Resolution {
    if (specifier.startsWith("./")) {
      const local = nodePath.posix.normalize(
        nodePath.posix.join(nodePath.posix.dirname(from), specifier),
      );
      return this.files.has(local)
        ? { kind: "file", local, certain: true }
        : { kind: "unresolved" };
    }
    for (const [prefix, dir] of this.psr4) {
      if (!specifier.startsWith(prefix)) continue;
      const rest = specifier.slice(prefix.length).replaceAll("\\", "/");
      const local = nodePath.posix.normalize(nodePath.posix.join(dir, `${rest}.php`));
      if (this.files.has(local)) return { kind: "file", local, certain: true };
    }
    return this.psr4.some(([prefix]) => specifier.startsWith(prefix))
      ? { kind: "unresolved" }
      : { kind: "external" };
  }
}
