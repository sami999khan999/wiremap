import { type FileRole, HTTP_METHODS, type HttpMethod } from "../import.js";
import type { ParsedFile } from "../model/index.js";
import type { FoundRoute, FrameworkPlugin, GuardableRoute } from "./framework-plugin.js";
import { RoutePath } from "./route-path.js";

const APP =
  /^(?:src\/)?app\/(?:(.*)\/)?(page|layout|route|loading|error|not-found|template|default|global-error)\.[cm]?[jt]sx?$/;
const PAGES = /^(?:src\/)?pages\/(.*)\.[cm]?[jt]sx?$/;
const MIDDLEWARE = /^(?:src\/)?(middleware|instrumentation)\.[cm]?[jt]s$/;
// What a middleware has to mention before it is taken to guard anything.
const AUTH = /auth|session|token|clerk|jwt|signin|sign-in|login|cookies\(/i;

// The App Router's `route.ts` handlers and `pages/api`, by file convention. A middleware
// that authenticates guards the paths its `matcher` names, or every path without one.
export class NextjsPlugin implements FrameworkPlugin {
  public readonly id = "nextjs" as const;
  public readonly npm = ["next"];

  public classify(file: ParsedFile): FileRole | null {
    const local = NextjsPlugin.inPackage(file);
    const app = APP.exec(local);
    if (app)
      return app[2] === "route"
        ? "api"
        : app[2] === "layout" || app[2] === "template"
          ? "layout"
          : "page";
    const pages = PAGES.exec(local);
    if (pages) {
      if (pages[1]?.startsWith("api/")) return "api";
      return pages[1] === "_app" || pages[1] === "_document" ? "layout" : "page";
    }
    if (MIDDLEWARE.test(local)) return "middleware";
    return null;
  }

  public isEntry(file: ParsedFile): boolean {
    const local = NextjsPlugin.inPackage(file);
    return (
      APP.test(local) ||
      PAGES.test(local) ||
      MIDDLEWARE.test(local) ||
      /^next\.config\./.test(local)
    );
  }

  public routes(file: ParsedFile): readonly FoundRoute[] {
    const local = NextjsPlugin.inPackage(file);
    const app = APP.exec(local);
    if (app?.[2] === "route") {
      const path = NextjsPlugin.appPath(app[1] ?? "");
      if (path === null) return [];
      return file.exports
        .filter((name): name is HttpMethod => (HTTP_METHODS as readonly string[]).includes(name))
        .map((method) => ({
          method,
          path,
          line: NextjsPlugin.lineOfExport(file, method),
          guards: [],
        }));
    }
    const pages = PAGES.exec(local);
    if (pages?.[1]?.startsWith("api/")) {
      const path = RoutePath.join(pages[1].replace(/(^|\/)index$/, ""));
      return [{ method: "ANY", path, line: 1, guards: [] }];
    }
    return [];
  }

  public guard(routes: GuardableRoute[], files: readonly ParsedFile[]): void {
    const middleware = files.find((file) =>
      /^(?:src\/)?middleware\.[cm]?[jt]s$/.test(NextjsPlugin.inPackage(file)),
    );
    if (!middleware || !AUTH.test(middleware.text)) return;
    const matchers = NextjsPlugin.matchers(middleware.text);
    for (const route of routes) {
      if (matchers.length === 0 || matchers.some((matcher) => matcher.test(route.path)))
        route.guards.push("middleware");
    }
  }

  // `/dashboard/:path*` and `/((?!api|_next).*)`, both as Next reads them.
  private static matchers(text: string): RegExp[] {
    const block = /matcher\s*:\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/.exec(text)?.[1] ?? "";
    const patterns = [...block.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1] as string);
    return patterns.flatMap((pattern) => {
      const source = pattern
        .replace(/\/:\w+\*/g, "(?:/.*)?")
        .replace(/:\w+\*/g, ".*")
        .replace(/:\w+\+/g, ".+")
        .replace(/:\w+\?/g, "[^/]*")
        .replace(/:\w+/g, "[^/]+");
      try {
        return [new RegExp(`^${source}$`)];
      } catch {
        return [];
      }
    });
  }

  // Route groups `(x)` and slots `@x` vanish; `_private` folders are not routable at all.
  private static appPath(dir: string): string | null {
    const segments = dir.split("/").filter((segment) => segment !== "");
    if (segments.some((segment) => segment.startsWith("_"))) return null;
    return RoutePath.join(
      ...segments.filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith("@")),
    );
  }

  private static lineOfExport(file: ParsedFile, name: string): number {
    const index = file.text.search(
      new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${name}\\b`),
    );
    return index === -1 ? 1 : file.text.slice(0, index).split("\n").length;
  }

  private static inPackage(file: ParsedFile): string {
    return file.packageDir === "" ? file.local : file.local.slice(file.packageDir.length + 1);
  }
}
