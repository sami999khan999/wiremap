import { nodePath, ts } from "../import.js";
import type { PackageInfo } from "../workspace/index.js";
import type { Resolution } from "./resolution.js";
import { SourceProbe } from "./source-probe.js";

// Not code: imported for a bundler, never an edge and never counted.
const ASSET =
  /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|json|md|mdx|txt|html|wasm|woff2?|ttf|eot|mp4|webm|graphql|gql|ya?ml)(\?.*)?$/i;
// Aliases a reader can see are internal without a tsconfig to say so.
const ALIAS = /^(@\/|~\/|#|\$lib\/|src\/)/;

// Module resolution the way the repository's own tsconfig would do it, with the workspace's
// packages mapped to their source: a runner's checkout has no `node_modules` to follow.
export class TypescriptResolver {
  private readonly probe: SourceProbe;
  private readonly configs = new Map<
    string,
    { options: ts.CompilerOptions; aliases: readonly RegExp[] }
  >();
  private readonly host: ts.ModuleResolutionHost;

  public constructor(
    private readonly root: string,
    private readonly files: ReadonlySet<string>,
    private readonly packages: readonly PackageInfo[],
    private readonly tsconfigPath: string | null,
  ) {
    this.probe = new SourceProbe(files);
    this.host = {
      fileExists: (path) => ts.sys.fileExists(path),
      readFile: (path) => ts.sys.readFile(path),
      directoryExists: (path) => ts.sys.directoryExists?.(path) ?? true,
      realpath: (path) => path,
    };
  }

  public resolve(from: string, specifier: string): Resolution {
    if (ASSET.test(specifier) || specifier.startsWith("node:") || /^[a-z]+:\/\//.test(specifier)) {
      return { kind: "external" };
    }
    const relative = specifier.startsWith(".") || specifier.startsWith("/");
    if (relative) {
      const base = nodePath.posix.normalize(
        nodePath.posix.join(nodePath.posix.dirname(from), specifier),
      );
      const found = this.probe.find(base);
      if (found) return { kind: "file", local: found, certain: true };
    }

    const workspace = this.workspace(specifier);
    if (workspace) return workspace;

    const config = this.configFor(from);
    const resolved = ts.resolveModuleName(
      specifier,
      nodePath.join(this.root, from),
      config.options,
      this.host,
    ).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport) {
      const local = nodePath
        .relative(this.root, resolved.resolvedFileName)
        .split(nodePath.sep)
        .join("/");
      if (!local.startsWith("..")) {
        const found =
          this.probe.find(local.replace(/\.d\.([cm]?ts)$/, ".$1")) ??
          (this.files.has(local) ? local : null);
        return found ? { kind: "file", local: found, certain: true } : { kind: "outside" };
      }
    }
    const internal =
      relative || ALIAS.test(specifier) || config.aliases.some((alias) => alias.test(specifier));
    return internal ? { kind: "unresolved" } : { kind: "external" };
  }

  // `@acme/ui` or `@acme/ui/button`, to the package's source. A `dist/` entry is mapped back
  // to `src/`, which is where the code a reader means actually is.
  private workspace(specifier: string): Resolution | null {
    const owner = this.packages
      .filter(
        (each) => each.name && (specifier === each.name || specifier.startsWith(`${each.name}/`)),
      )
      .toSorted((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0];
    if (!owner?.name) return null;
    const sub = specifier.slice(owner.name.length).replace(/^\//, "");
    const join = (...parts: string[]) => nodePath.posix.join(owner.dir, ...parts);
    const candidates = sub
      ? [join(sub), join("src", sub)]
      : [
          ...owner.entries.flatMap((entry) => [
            entry,
            entry.replace(/\/(dist|build|lib|out)\//, "/src/"),
          ]),
          join("src/index"),
          join("index"),
        ];
    for (const candidate of candidates) {
      const found = this.probe.find(candidate.replace(/\.d\.[cm]?ts$/, ""));
      if (found) return { kind: "file", local: found, certain: true };
    }
    return { kind: "unresolved" };
  }

  private configFor(from: string): { options: ts.CompilerOptions; aliases: readonly RegExp[] } {
    const path = this.tsconfigPath
      ? nodePath.join(this.root, this.tsconfigPath)
      : this.nearest(nodePath.posix.dirname(from));
    const key = path ?? "";
    const cached = this.configs.get(key);
    if (cached) return cached;
    let options: ts.CompilerOptions = {};
    if (path) {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        path,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: () => undefined,
        },
      );
      options = parsed?.options ?? {};
    }
    // A checkout has no `node_modules`, so a tsconfig extending a package parses partly; the
    // defaults below are what a bundler-era project would have had anyway.
    const resolution = options.moduleResolution;
    const config = {
      options: {
        ...options,
        allowJs: true,
        moduleResolution:
          resolution === undefined || resolution === ts.ModuleResolutionKind.Classic
            ? ts.ModuleResolutionKind.Bundler
            : resolution,
        module: options.module ?? ts.ModuleKind.ESNext,
        customConditions: options.customConditions ?? ["development", "source"],
      },
      aliases: Object.keys(options.paths ?? {}).map(
        (pattern) =>
          new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*")}$`),
      ),
    };
    this.configs.set(key, config);
    return config;
  }

  private nearest(dir: string): string | null {
    let current = dir === "." ? "" : dir;
    for (;;) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const candidate = nodePath.join(this.root, current, name);
        if (ts.sys.fileExists(candidate)) return candidate;
      }
      if (current === "") return null;
      current = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
    }
  }
}
