import { type FileRole, type HttpMethod, ts } from "../import.js";
import type { ParsedFile } from "../model/index.js";
import type {
  FoundRoute,
  FrameworkPlugin,
  GuardableRoute,
  PluginContext,
} from "./framework-plugin.js";
import { RoutePath } from "./route-path.js";
import { TsSyntax } from "./ts-syntax.js";

const METHODS: Readonly<Record<string, HttpMethod>> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  Options: "OPTIONS",
  Head: "HEAD",
  All: "ANY",
};

const BY_DECORATOR: Readonly<Record<string, FileRole>> = {
  Controller: "controller",
  Resolver: "resolver",
  WebSocketGateway: "gateway",
  Module: "module",
  Entity: "entity",
  Schema: "entity",
  Catch: "filter",
};

const BY_INTERFACE: Readonly<Record<string, FileRole>> = {
  CanActivate: "guard",
  NestInterceptor: "interceptor",
  PipeTransform: "pipe",
  ExceptionFilter: "filter",
  NestMiddleware: "middleware",
};

// Routes from `@Controller` prefixes and method decorators, guards from `@UseGuards`, and an
// `inject` edge for each constructor dependency. The global prefix and guards apply after.
export class NestjsPlugin implements FrameworkPlugin {
  public readonly id = "nestjs" as const;
  public readonly npm = ["@nestjs/core", "@nestjs/common"];

  public classify(file: ParsedFile): FileRole | null {
    for (const node of NestjsPlugin.classes(file)) {
      for (const decorator of TsSyntax.decorators(node)) {
        const role = BY_DECORATOR[decorator.name];
        if (role) return role;
      }
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types) {
          const role = BY_INTERFACE[TsSyntax.calleeName(type.expression) ?? ""];
          if (role) return role;
        }
      }
    }
    return null;
  }

  public isEntry(file: ParsedFile): boolean {
    return file.text.includes("NestFactory.create");
  }

  public routes(file: ParsedFile): readonly FoundRoute[] {
    const source = file.typescript;
    if (!source) return [];
    const routes: FoundRoute[] = [];
    for (const node of NestjsPlugin.classes(file)) {
      const decorators = TsSyntax.decorators(node);
      const controller = decorators.find((decorator) => decorator.name === "Controller");
      if (!controller) continue;
      const prefix = TsSyntax.stringOf(controller.args[0]) ?? "";
      const classGuards = NestjsPlugin.guards(decorators);
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const own = TsSyntax.decorators(member);
        for (const decorator of own) {
          const method = METHODS[decorator.name];
          if (!method) continue;
          routes.push({
            method,
            path: RoutePath.join(prefix, TsSyntax.stringOf(decorator.args[0]) ?? ""),
            line: TsSyntax.lineOf(source, decorator.node),
            guards: [...classGuards, ...NestjsPlugin.guards(own)],
          });
        }
      }
    }
    return routes;
  }

  // Each constructor parameter's type, or the token in `@Inject(X)` / `@InjectRepository(X)`,
  // followed through this file's imports to the file that declares it.
  public injects(file: ParsedFile, context: PluginContext) {
    const source = file.typescript;
    if (!source) return [];
    const found: { to: string; line: number }[] = [];
    for (const node of NestjsPlugin.classes(file)) {
      for (const member of node.members) {
        if (!ts.isConstructorDeclaration(member)) continue;
        for (const parameter of member.parameters) {
          const names: string[] = [];
          const type = parameter.type;
          if (type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName))
            names.push(type.typeName.text);
          for (const decorator of TsSyntax.decorators(parameter)) {
            if (decorator.name.startsWith("Inject"))
              names.push(...TsSyntax.identifiers(decorator.args));
          }
          for (const name of names) {
            const specifier = file.imports.find((each) => each.names.includes(name))?.specifier;
            const to = specifier ? context.resolve(file, specifier) : null;
            if (to && to !== file.local)
              found.push({ to, line: TsSyntax.lineOf(source, parameter) });
          }
        }
      }
    }
    return found;
  }

  // `forRoutes` middleware and global guards, then the global prefix: last, because
  // `forRoutes` paths are written without it.
  public guard(routes: GuardableRoute[], files: readonly ParsedFile[]): void {
    let prefix: string | null = null;
    let global = false;
    const declaring = new Map<string, string>();
    for (const file of files) for (const name of file.exports) declaring.set(name, file.local);
    for (const file of files) {
      if (!file.typescript) continue;
      if (file.text.includes("useGlobalGuards") || file.text.includes("APP_GUARD")) global = true;
      TsSyntax.walk(file.typescript, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = TsSyntax.calleeName(node.expression);
        if (name === "setGlobalPrefix") prefix = TsSyntax.stringOf(node.arguments[0]) ?? prefix;
        if (name === "forRoutes") NestjsPlugin.middleware(node, routes, declaring);
      });
    }
    for (const route of routes) {
      if (global && !route.guards.includes("global")) route.guards.push("global");
      if (prefix) route.path = RoutePath.join(prefix, route.path);
    }
  }

  private static middleware(
    call: ts.CallExpression,
    routes: GuardableRoute[],
    declaring: ReadonlyMap<string, string>,
  ): void {
    const applied = call.expression;
    if (!ts.isPropertyAccessExpression(applied) || !ts.isCallExpression(applied.expression)) return;
    if (TsSyntax.calleeName(applied.expression.expression) !== "apply") return;
    const names = TsSyntax.identifiers(applied.expression.arguments);
    if (names.length === 0) return;
    const add = (route: GuardableRoute) => {
      for (const name of names) if (!route.guards.includes(name)) route.guards.push(name);
    };
    for (const target of call.arguments) {
      if (ts.isStringLiteralLike(target) || ts.isObjectLiteralExpression(target)) {
        const path = RoutePath.shape(RoutePath.join(TsSyntax.stringOf(target) ?? ""));
        const method = ts.isObjectLiteralExpression(target)
          ? (TsSyntax.property(target, "method")?.getText().split(".").pop() ?? "ALL")
          : "ALL";
        for (const route of routes) {
          const shape = RoutePath.shape(route.path);
          const wildcard = path.endsWith("*") && shape.startsWith(path.slice(0, -1));
          if ((method === "ALL" || method === route.method) && (wildcard || shape === path))
            add(route);
        }
      } else if (ts.isIdentifier(target)) {
        const local = declaring.get(target.text);
        for (const route of routes) if (route.local === local) add(route);
      }
    }
  }

  private static guards(decorators: ReturnType<typeof TsSyntax.decorators>): string[] {
    return decorators
      .filter((decorator) => decorator.name === "UseGuards")
      .flatMap((decorator) => TsSyntax.identifiers(decorator.args));
  }

  private static classes(file: ParsedFile): ts.ClassDeclaration[] {
    const classes: ts.ClassDeclaration[] = [];
    for (const statement of file.typescript?.statements ?? [])
      if (ts.isClassDeclaration(statement)) classes.push(statement);
    return classes;
  }
}
