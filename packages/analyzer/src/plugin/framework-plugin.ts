import type { FileRole, GraphFramework, HttpMethod } from "../import.js";
import type { ParsedFile } from "../model/index.js";

export interface FoundRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly line: number;
  readonly guards: readonly string[];
  // Where the handler is, when the route is declared in one file and handled in another
  // (Laravel's routes files). Absent: the file the plugin was reading.
  readonly handler?: { readonly local: string; readonly line: number };
}

// A route as the post-pass sees it: path and guards may change, the rest is for matching.
export interface GuardableRoute {
  path: string;
  guards: string[];
  readonly method: HttpMethod;
  readonly local: string;
}

export interface PluginContext {
  readonly files: ReadonlyMap<string, ParsedFile>;
  // An import specifier or class name from `file`, to the local path it resolves to.
  resolve(file: ParsedFile, specifier: string): string | null;
}

// One framework's knowledge: which files are which role, which are entry points, the routes
// it declares and the injections it wires. Every method is optional; `detect` is the gate.
export interface FrameworkPlugin {
  readonly id: GraphFramework;
  // Turns on for a package that depends on one of these, or a composer project requiring one.
  readonly npm?: readonly string[];
  readonly composer?: readonly string[];
  classify?(file: ParsedFile): FileRole | null;
  isEntry?(file: ParsedFile): boolean;
  routes?(file: ParsedFile, context: PluginContext): readonly FoundRoute[];
  injects?(
    file: ParsedFile,
    context: PluginContext,
  ): readonly { readonly to: string; readonly line: number }[];
  // Once, after every file: guards that are configured globally rather than per route.
  guard?(
    routes: { path: string; guards: string[]; local: string }[],
    files: readonly ParsedFile[],
  ): void;
}
