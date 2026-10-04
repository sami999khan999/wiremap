import { type FileRole, HTTP_METHODS, type HttpMethod, ts } from "../import.js";
import type { ParsedFile } from "../model/index.js";
import type { FoundRoute, FrameworkPlugin } from "./framework-plugin.js";
import { RoutePath } from "./route-path.js";
import { TsSyntax } from "./ts-syntax.js";

const CREATORS = new Set([
  "createFileRoute",
  "createServerFileRoute",
  "createAPIFileRoute",
  "createRootRoute",
  "createRootRouteWithContext",
]);
const ENTRY = /(^|\/)(router|client|server|start|ssr)\.[cm]?[jt]sx?$|routeTree\.gen\.ts$/;

// `createFileRoute("/path")` makes a route file; its `server.handlers` (or the older
// `createServerFileRoute(...).methods`, `createAPIFileRoute(...)`) are backend routes.
export class TanstackStartPlugin implements FrameworkPlugin {
  public readonly id = "tanstack-start" as const;
  public readonly npm = ["@tanstack/react-start", "@tanstack/start", "@tanstack/solid-start"];

  public classify(file: ParsedFile): FileRole | null {
    const found = TanstackStartPlugin.declaration(file);
    if (!found) return null;
    return found.methods.length > 0 && !found.page ? "api" : "route";
  }

  public isEntry(file: ParsedFile): boolean {
    return TanstackStartPlugin.declaration(file) !== null || ENTRY.test(file.local);
  }

  public routes(file: ParsedFile): readonly FoundRoute[] {
    const found = TanstackStartPlugin.declaration(file);
    if (!found || found.path === null) return [];
    const path = TanstackStartPlugin.urlOf(found.path);
    const handlers = found.methods.map(({ method, line }) => ({
      method,
      path,
      line,
      guards: found.guards,
    }));
    // A route with a component is a page someone visits, beside any server handlers it has.
    return found.page
      ? [{ method: "PAGE" as const, path, line: 1, guards: found.guards }, ...handlers]
      : handlers;
  }

  // `/_auth/posts/$postId/` → `/posts/:postId`: pathless layouts and groups do not appear.
  public static urlOf(path: string): string {
    const segments = path
      .split("/")
      .filter((segment) => segment !== "" && !segment.startsWith("_") && !/^\(.*\)$/.test(segment));
    return RoutePath.join(...segments.map((segment) => segment.replace(/_$/, "")));
  }

  private static declaration(file: ParsedFile) {
    const source = file.typescript;
    if (!source || !/create(Server|API)?FileRoute|createRoot/.test(file.text)) return null;
    let path: string | null = null;
    let page = false;
    // The options object decides; the bare `createFileRoute("/x")` inside it must not undo that.
    let decided = false;
    const methods: { method: HttpMethod; line: number }[] = [];
    const guards: string[] = [];
    const collect = (object: ts.ObjectLiteralExpression) => {
      for (const property of object.properties) {
        const key = property.name ? TsSyntax.nameOf(property.name) : null;
        if (
          key &&
          (HTTP_METHODS as readonly string[]).includes(key) &&
          !methods.some((each) => each.method === key)
        ) {
          methods.push({ method: key as HttpMethod, line: TsSyntax.lineOf(source, property) });
        }
      }
    };
    TsSyntax.walk(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const name = TsSyntax.calleeName(node.expression);
      if (name && CREATORS.has(name)) {
        path = TsSyntax.stringOf(node.arguments[0]) ?? (name.startsWith("createRoot") ? "/" : path);
        if (name === "createFileRoute" && !decided) page = true;
      }
      if (name === "middleware") guards.push(...TsSyntax.identifiers(node.arguments));
      if (name === "methods" || name === "createHandlers") {
        for (const arg of node.arguments) if (ts.isObjectLiteralExpression(arg)) collect(arg);
      }
      // `createAPIFileRoute("/x")({ GET })`: the object is the argument of the outer call.
      if (
        ts.isCallExpression(node.expression) &&
        TsSyntax.calleeName(node.expression.expression) === "createAPIFileRoute"
      ) {
        for (const arg of node.arguments) if (ts.isObjectLiteralExpression(arg)) collect(arg);
      }
      if (
        ts.isCallExpression(node.expression) &&
        TsSyntax.calleeName(node.expression.expression) === "createFileRoute"
      ) {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          const component = TsSyntax.property(options, "component");
          const server = TsSyntax.property(options, "server");
          page = component !== undefined || server === undefined;
          decided = true;
          if (server && ts.isObjectLiteralExpression(server)) {
            const handlers = TsSyntax.property(server, "handlers");
            if (handlers && ts.isObjectLiteralExpression(handlers)) collect(handlers);
            const middleware = TsSyntax.property(server, "middleware");
            if (middleware) guards.push(...TsSyntax.identifiers([middleware]));
          }
        }
      }
    });
    return path === null && methods.length === 0 ? null : { path, page, methods, guards };
  }
}
