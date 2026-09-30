import { Env } from "~/env.js";

// A second shell is served from a custom protocol, so **every** call it makes is
// cross-origin. Reads the same allowlist as the CSRF check.
export class Cors {
  private constructor() {}

  private static headersFor(origin: string | null): Headers {
    const headers = new Headers();
    // Echo the origin, never reflect it blindly: reflecting an arbitrary one alongside
    // `Allow-Credentials: true` is a CSRF hole.
    if (!origin || !Env.trustedOrigins.includes(origin)) return headers;

    headers.set("Access-Control-Allow-Origin", origin);
    // Required: the web client authenticates with a cookie and the desktop client with
    // a bearer token, against the same two routes (16, 18).
    headers.set("Access-Control-Allow-Credentials", "true");
    // `x-api-key`, because `PrincipalBuilder` checks it first: omitting it fails
    // preflight with a message that never names the header.
    // ──
    // `last-event-id` is not safelisted and the oRPC client sends it on every stream
    // reconnect, so without it a cross-origin stream can never resume — only reopen.
    headers.set(
      "Access-Control-Allow-Headers",
      "content-type,authorization,x-api-key,last-event-id",
    );
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    // Not optional: without it a cache in front of this can serve one origin's CORS
    // response to another, and the failure looks random.
    headers.set("Vary", "Origin");
    return headers;
  }

  // Returns null when the request is not a preflight.
  public static preflight(request: Request): Response | null {
    if (request.method !== "OPTIONS") return null;
    return new Response(null, {
      status: 204,
      headers: Cors.headersFor(request.headers.get("origin")),
    });
  }

  public static apply(request: Request, response: Response): Response {
    for (const [key, value] of Cors.headersFor(request.headers.get("origin"))) {
      response.headers.set(key, value);
    }
    return response;
  }
}
