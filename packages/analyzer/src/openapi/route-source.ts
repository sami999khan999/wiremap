import { execFile, type HttpMethod, nodePath, parseYaml, promisify, readFile } from "../import.js";
import { RoutePath } from "../plugin/index.js";
import { FileWalker } from "../walk/index.js";

export interface SourcedRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly local: string;
  readonly line: number;
  readonly guards: readonly string[];
  // A controller class and method to locate, for an artisan route.
  readonly action?: { readonly className: string; readonly method: string };
}

const SPEC = /^(openapi|swagger)\.(json|ya?ml)$/i;
const VERBS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const run = promisify(execFile);

// Routes from ground truth rather than from reading code: an OpenAPI file in the repository,
// or Laravel's own `route:list` when the run asks for it (it needs PHP and a vendor folder).
export class RouteSource {
  private constructor() {}

  public static async openapi(root: string, ignore: readonly string[]): Promise<SourcedRoute[]> {
    const routes: SourcedRoute[] = [];
    for (const file of await FileWalker.find(root, ignore, (name) => SPEC.test(name))) {
      const text = await readFile(file.absolute, "utf8").catch(() => "");
      const spec = RouteSource.parse(text, file.local.endsWith(".json"));
      for (const [path, operations] of Object.entries(spec?.paths ?? {})) {
        const index = text.indexOf(path);
        const line = index === -1 ? 1 : text.slice(0, index).split("\n").length;
        for (const verb of Object.keys(operations ?? {})) {
          const method = verb.toUpperCase() as HttpMethod;
          if (!VERBS.includes(method)) continue;
          const operation = operations[verb] as { security?: unknown[] } | undefined;
          const guards =
            Array.isArray(operation?.security) && operation.security.length > 0 ? ["security"] : [];
          routes.push({ method, path: RoutePath.join(path), local: file.local, line, guards });
        }
      }
    }
    return routes;
  }

  private static parse(
    text: string,
    json: boolean,
  ): { paths?: Record<string, Record<string, unknown>> } | null {
    try {
      const value: unknown = json ? JSON.parse(text) : parseYaml(text);
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  public static async artisan(root: string): Promise<SourcedRoute[]> {
    const { stdout } = await run("php", ["artisan", "route:list", "--json"], {
      cwd: root,
      timeout: 60_000,
      maxBuffer: 50_000_000,
    });
    const rows = JSON.parse(stdout) as {
      method: string;
      uri: string;
      action: string;
      middleware?: string[];
    }[];
    const routes: SourcedRoute[] = [];
    for (const row of rows) {
      const [className, method] = row.action.includes("@")
        ? row.action.split("@")
        : [row.action, "__invoke"];
      for (const verb of row.method.split("|")) {
        if (verb === "HEAD" && row.method.includes("GET")) continue;
        routes.push({
          method: verb as HttpMethod,
          path: RoutePath.join(row.uri),
          local: nodePath.posix.join("routes", "web.php"),
          line: 1,
          guards: (row.middleware ?? []).filter((name) =>
            /^(auth|can:|verified|sanctum|Illuminate\\Auth)/.test(name),
          ),
          ...(className && className !== "Closure"
            ? { action: { className, method: method ?? "__invoke" } }
            : {}),
        });
      }
    }
    return routes;
  }
}
