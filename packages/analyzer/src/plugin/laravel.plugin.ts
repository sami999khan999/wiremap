import type { HttpMethod, SyntaxNode } from "../import.js";
import { PhpParser } from "../language/index.js";
import type { ParsedFile } from "../model/index.js";
import type { FoundRoute, FrameworkPlugin, PluginContext } from "./framework-plugin.js";
import { RoutePath } from "./route-path.js";

interface Scope {
  readonly prefix: string;
  readonly middleware: readonly string[];
  readonly controller: string | null;
}

interface Call {
  readonly name: string;
  readonly args: readonly SyntaxNode[];
  readonly line: number;
}

const VERBS: Readonly<Record<string, readonly HttpMethod[]>> = {
  get: ["GET"],
  post: ["POST"],
  put: ["PUT"],
  patch: ["PATCH"],
  delete: ["DELETE"],
  options: ["OPTIONS"],
  any: ["ANY"],
};

// The seven actions `Route::resource` makes, and which of them `apiResource` keeps.
const RESOURCE: readonly (readonly [string, HttpMethod, string, boolean])[] = [
  ["index", "GET", "", true],
  ["create", "GET", "/create", false],
  ["store", "POST", "", true],
  ["show", "GET", "/{id}", true],
  ["edit", "GET", "/{id}/edit", false],
  ["update", "PUT", "/{id}", true],
  ["destroy", "DELETE", "/{id}", true],
];

const ENTRY =
  /^(routes\/|app\/Providers\/|app\/Console\/|app\/Http\/Kernel\.php|config\/|database\/|bootstrap\/|public\/index\.php|artisan$)/;
// The middleware that authenticates. Anything else on a route is not a guard.
const GUARD = /^(auth|can:|verified|sanctum|passport|jwt|role:|permission:)/;

// `routes/*.php` read through the syntax tree: verbs, `match`, resources, and groups by
// array or by chain (`prefix`, `middleware`, `controller`). `api.php` is under `/api`.
export class LaravelPlugin implements FrameworkPlugin {
  public readonly id = "laravel" as const;
  public readonly composer = ["laravel/framework"];

  public isEntry(file: ParsedFile): boolean {
    return ENTRY.test(LaravelPlugin.inProject(file));
  }

  public classify(file: ParsedFile) {
    return /^routes\/[^/]+\.php$/.test(LaravelPlugin.inProject(file)) ? ("route" as const) : null;
  }

  public routes(file: ParsedFile, context: PluginContext): readonly FoundRoute[] {
    const local = LaravelPlugin.inProject(file);
    if (!file.php || !/^routes\/[^/]+\.php$/.test(local)) return [];
    const base: Scope = {
      prefix: local === "routes/api.php" ? "api" : "",
      middleware: [],
      controller: null,
    };
    const routes: FoundRoute[] = [];
    this.statements(file.php.root, base, file, context, routes);
    return routes;
  }

  private statements(
    node: SyntaxNode,
    scope: Scope,
    file: ParsedFile,
    context: PluginContext,
    out: FoundRoute[],
  ): void {
    for (const child of node.namedChildren) {
      if (!child) continue;
      if (child.type === "expression_statement") {
        const expression = child.namedChild(0);
        if (expression) this.statement(expression, scope, file, context, out);
      } else if (child.type === "compound_statement") {
        this.statements(child, scope, file, context, out);
      }
    }
  }

  private statement(
    expression: SyntaxNode,
    scope: Scope,
    file: ParsedFile,
    context: PluginContext,
    out: FoundRoute[],
  ): void {
    const chain = LaravelPlugin.chain(expression);
    if (!chain || chain.length === 0) return;
    let inner: Scope = scope;
    let body: SyntaxNode | null = null;
    for (const call of chain) {
      if (call.name === "prefix")
        inner = {
          ...inner,
          prefix: RoutePath.join(inner.prefix, LaravelPlugin.string(call.args[0]) ?? ""),
        };
      if (call.name === "middleware")
        inner = {
          ...inner,
          middleware: [...inner.middleware, ...LaravelPlugin.strings(call.args[0])],
        };
      if (call.name === "controller")
        inner = { ...inner, controller: LaravelPlugin.className(call.args[0]) ?? inner.controller };
      if (call.name === "group") {
        const options = call.args.find((arg) => arg.type === "array_creation_expression");
        if (options) inner = LaravelPlugin.groupOptions(options, inner);
        body =
          call.args.find(
            (arg) =>
              arg.type === "anonymous_function" ||
              arg.type === "arrow_function" ||
              arg.type === "anonymous_function_creation_expression",
          ) ?? null;
      }
    }
    if (body) {
      const block =
        body.childForFieldName("body") ??
        body.namedChildren.find((child) => child?.type === "compound_statement") ??
        null;
      if (block) this.statements(block, inner, file, context, out);
      return;
    }

    const head = chain[0] as Call;
    const middleware = inner.middleware;
    const guards = () => middleware.filter((name) => GUARD.test(name));
    const verbs =
      VERBS[head.name] ??
      (head.name === "match"
        ? LaravelPlugin.strings(head.args[0]).flatMap((verb) => VERBS[verb.toLowerCase()] ?? [])
        : null);
    if (verbs) {
      const offset = head.name === "match" ? 1 : 0;
      const path = LaravelPlugin.string(head.args[offset]);
      if (path === null) return;
      const handler = this.handler(head.args[offset + 1], inner, file, context);
      for (const method of verbs) {
        out.push({
          method,
          path: RoutePath.join(inner.prefix, path),
          line: head.line,
          guards: guards(),
          ...(handler ? { handler } : {}),
        });
      }
      return;
    }
    if (head.name === "resource" || head.name === "apiResource") {
      const name = LaravelPlugin.string(head.args[0]);
      const controller = LaravelPlugin.className(head.args[1]);
      if (name === null) return;
      const only = chain.find((call) => call.name === "only");
      const except = chain.find((call) => call.name === "except");
      for (const [action, method, suffix, api] of RESOURCE) {
        if (head.name === "apiResource" && !api) continue;
        if (only && !LaravelPlugin.strings(only.args[0]).includes(action)) continue;
        if (except && LaravelPlugin.strings(except.args[0]).includes(action)) continue;
        const handler = controller ? this.locate(controller, action, file, context) : null;
        out.push({
          method,
          path: RoutePath.join(inner.prefix, name, suffix),
          line: head.line,
          guards: guards(),
          ...(handler ? { handler } : {}),
        });
      }
    }
  }

  // `[UserController::class, 'index']`, `'UserController@index'`, or `'index'` inside a
  // `controller()` group. A closure's handler is the routes file itself.
  private handler(
    node: SyntaxNode | undefined,
    scope: Scope,
    file: ParsedFile,
    context: PluginContext,
  ) {
    if (!node) return null;
    if (node.type === "array_creation_expression") {
      const [first, second] = LaravelPlugin.elements(node).map((element) => element.value);
      const controller = LaravelPlugin.className(first);
      return controller
        ? this.locate(controller, LaravelPlugin.string(second) ?? "__invoke", file, context)
        : null;
    }
    const text = LaravelPlugin.string(node);
    if (text?.includes("@")) {
      const [controller, method] = text.split("@");
      return controller ? this.locate(controller, method ?? "__invoke", file, context) : null;
    }
    if (text && scope.controller) return this.locate(scope.controller, text, file, context);
    const invokable = LaravelPlugin.className(node);
    return invokable ? this.locate(invokable, "__invoke", file, context) : null;
  }

  private locate(controller: string, method: string, file: ParsedFile, context: PluginContext) {
    const php = file.php;
    const qualified = php ? PhpParser.qualify(controller, php.namespace, php.uses) : controller;
    const candidates = [qualified, `App\\Http\\Controllers\\${controller}`];
    for (const candidate of candidates) {
      const local = context.resolve(file, candidate);
      if (!local) continue;
      const target = context.files.get(local);
      const declaration = target?.php
        ? PhpParser.descendants(target.php.root).find(
            (node) =>
              node.type === "method_declaration" && node.childForFieldName("name")?.text === method,
          )
        : undefined;
      return { local, line: declaration ? declaration.startPosition.row + 1 : 1 };
    }
    return null;
  }

  // `Route::group(['prefix' => 'admin', 'middleware' => ['auth']], fn () => ...)`.
  private static groupOptions(array: SyntaxNode, scope: Scope): Scope {
    let next = scope;
    for (const { key, value } of LaravelPlugin.elements(array)) {
      const name = LaravelPlugin.string(key);
      if (name === "prefix")
        next = { ...next, prefix: RoutePath.join(next.prefix, LaravelPlugin.string(value) ?? "") };
      if (name === "middleware")
        next = { ...next, middleware: [...next.middleware, ...LaravelPlugin.strings(value)] };
    }
    return next;
  }

  // `Route::a(...)->b(...)->c(...)` as `[a, b, c]`, or null when it does not start at `Route::`.
  private static chain(expression: SyntaxNode): Call[] | null {
    const calls: Call[] = [];
    let node: SyntaxNode | null = expression;
    while (node) {
      if (node.type === "member_call_expression") {
        calls.unshift(LaravelPlugin.call(node));
        node = node.childForFieldName("object");
      } else if (node.type === "scoped_call_expression") {
        const scope = node.childForFieldName("scope")?.text ?? "";
        if (!/(^|\\)Route$/.test(scope)) return null;
        calls.unshift(LaravelPlugin.call(node));
        return calls;
      } else {
        return null;
      }
    }
    return null;
  }

  private static call(node: SyntaxNode): Call {
    const args = node.childForFieldName("arguments");
    return {
      name: node.childForFieldName("name")?.text ?? "",
      args: (args?.namedChildren ?? []).flatMap((arg) => {
        const value = arg?.type === "argument" ? arg.namedChild(arg.namedChildCount - 1) : arg;
        return value ? [value] : [];
      }),
      line: node.startPosition.row + 1,
    };
  }

  private static elements(
    array: SyntaxNode,
  ): { key: SyntaxNode | undefined; value: SyntaxNode | undefined }[] {
    return array.namedChildren
      .filter((child): child is SyntaxNode => child?.type === "array_element_initializer")
      .map((element) => {
        const parts = element.namedChildren.filter((child): child is SyntaxNode => child !== null);
        return parts.length >= 2
          ? { key: parts[0], value: parts[1] }
          : { key: undefined, value: parts[0] };
      });
  }

  private static string(node: SyntaxNode | undefined): string | null {
    if (!node || (node.type !== "string" && node.type !== "encapsed_string")) return null;
    return node.namedChildren
      .filter(
        (child): child is SyntaxNode =>
          child?.type === "string_content" || child?.type === "string_value",
      )
      .map((child) => child.text)
      .join("");
  }

  private static strings(node: SyntaxNode | undefined): string[] {
    if (!node) return [];
    if (node.type === "array_creation_expression") {
      return LaravelPlugin.elements(node).flatMap(({ value }) => {
        const text = LaravelPlugin.string(value);
        return text === null ? [] : [text];
      });
    }
    const text = LaravelPlugin.string(node);
    return text === null ? [] : [text];
  }

  private static className(node: SyntaxNode | undefined): string | null {
    if (node?.type !== "class_constant_access_expression") return null;
    const target = node.namedChild(0);
    return target && (target.type === "name" || target.type === "qualified_name")
      ? target.text
      : null;
  }

  private static inProject(file: ParsedFile): string {
    return file.packageDir === "" ? file.local : file.local.slice(file.packageDir.length + 1);
  }
}
