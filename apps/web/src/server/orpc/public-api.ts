import { container } from "../container.js";
import {
  OpenAPIGenerator,
  OpenAPIHandler,
  experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin,
  ZodToJsonSchemaConverter,
} from "../import.js";
import { GraphRouter } from "./graph.router.js";
import { ProjectRouter } from "./project.router.js";
import { ScanRouter } from "./scan.router.js";

// The read-only subset, under the same keys as `appRouter`: the permission map is looked
// up by path, so a renamed key here would be a procedure nothing maps and every call denied.
const publicRouter = {
  project: { list: ProjectRouter.list, get: ProjectRouter.get },
  scan: { list: ScanRouter.list, graph: ScanRouter.graph },
  graph: GraphRouter.all,
};

const PREFIX = "/api/v1";
// Per key, per minute. The per-procedure limits in the chain still apply underneath.
const LIMIT = 120;
const WINDOW_SECONDS = 60;

const handler = new OpenAPIHandler(publicRouter, {
  plugins: [new ZodSmartCoercionPlugin()],
});

let spec: Promise<unknown> | null = null;

// REST at `/api/v1`, for API keys only. A cookie is dropped before the chain sees the
// request, so a browser session can never be ridden through a URL someone was sent.
export class PublicApi {
  private constructor() {}

  public static async handle(request: Request): Promise<Response> {
    // Read-only, so GET alone, and a fresh request with no body to carry across.
    if (request.method !== "GET") return PublicApi.problem(405, "METHOD_NOT_ALLOWED");
    if (new URL(request.url).pathname === `${PREFIX}/openapi.json`) {
      return Response.json(await PublicApi.spec());
    }

    const key =
      request.headers.get("x-api-key") ??
      request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ??
      null;
    if (!key) return PublicApi.problem(401, "UNAUTHORIZED");
    if (await PublicApi.limited(key)) return PublicApi.problem(429, "RATE_LIMITED");

    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    headers.set("x-api-key", key);
    const { matched, response } = await handler.handle(new Request(request.url, { headers }), {
      prefix: PREFIX,
      context: { container, headers },
    });
    return matched ? response : PublicApi.problem(404, "NOT_FOUND");
  }

  // Built once per process: the router does not change while it runs.
  public static spec(): Promise<unknown> {
    spec ??= new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] }).generate(
      publicRouter,
      {
        info: {
          title: "wiremap API",
          version: "1",
          description: "Read-only access to projects, scans and their graphs, by API key.",
        },
        servers: [{ url: PREFIX }],
        security: [{ apiKey: [] }],
        components: {
          securitySchemes: {
            apiKey: { type: "http", scheme: "bearer", description: "An organization API key." },
          },
        },
      },
    );
    return spec;
  }

  // Keyed by a digest, so the key itself never becomes a Redis key name.
  private static async limited(key: string): Promise<boolean> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const id = Buffer.from(digest).toString("base64url").slice(0, 22);
    const count = await container.rateLimits.hit(`rate:v1:${id}`, WINDOW_SECONDS).catch(() => 0);
    return count > LIMIT;
  }

  private static problem(status: number, code: string): Response {
    return Response.json({ code, status }, { status });
  }
}
