import { describe, expect, it } from "vitest";
import { Cors } from "../../src/server/cors.js";

const ALLOWED = "http://localhost:23000";
const DESKTOP = "tauri://localhost";
const HOSTILE = "https://evil.example";

function preflightFrom(origin: string | null): Response {
  const headers = origin === null ? undefined : { origin };
  const response = Cors.preflight(
    new Request("http://localhost:23000/api/rpc", {
      method: "OPTIONS",
      headers,
    }),
  );

  if (!response) throw new Error("An OPTIONS request must produce a preflight response.");
  return response;
}

describe("Cors", () => {
  it("is not a preflight for anything but OPTIONS", () => {
    const request = new Request("http://localhost:23000/api/rpc", { method: "POST" });
    expect(Cors.preflight(request)).toBeNull();
  });

  it("echoes an allowed origin with credentials and a Vary", () => {
    const headers = preflightFrom(ALLOWED).headers;

    expect(headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    // Without `Vary: Origin`, any cache in front of this can serve one origin's CORS
    // response to another — and the failure looks random rather than like a cache bug.
    expect(headers.get("Vary")).toBe("Origin");
  });

  it("allows the desktop origin, which is cross-origin on every call", () => {
    expect(preflightFrom(DESKTOP).headers.get("Access-Control-Allow-Origin")).toBe(DESKTOP);
  });

  it("emits nothing at all for an origin that is not on the list", () => {
    const headers = preflightFrom(HOSTILE).headers;

    // Nothing, not "reflected without credentials": reflecting an arbitrary origin
    // alongside `Allow-Credentials: true` is a CSRF hole.
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(headers.get("Vary")).toBeNull();
  });

  it("emits nothing for a request with no origin", () => {
    expect(preflightFrom(null).headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  // Not a safelisted header, and the oRPC client sends it on every stream reconnect —
  // so without it a cross-origin stream fails preflight forever and can only reopen.
  it("advertises last-event-id, without which a stream can never resume", () => {
    const allowed = preflightFrom(ALLOWED).headers.get("Access-Control-Allow-Headers") ?? "";

    expect(allowed.split(",")).toContain("last-event-id");
  });

  it("advertises x-api-key, which PrincipalBuilder checks before the cookie", () => {
    const allowed = preflightFrom(ALLOWED).headers.get("Access-Control-Allow-Headers") ?? "";

    // Omitting it means integrations calling from a browser context fail preflight with
    // a message that never mentions the header they are missing.
    expect(allowed.split(",")).toContain("x-api-key");
  });

  it("answers a preflight with 204 and no body", async () => {
    const response = preflightFrom(ALLOWED);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("copies the headers onto a real response without disturbing its body", async () => {
    const request = new Request("http://localhost:23000/api/rpc", {
      method: "POST",
      headers: { origin: ALLOWED },
    });

    const response = Cors.apply(request, new Response("payload", { status: 201 }));

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("payload");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
  });

  it("leaves a response to an untrusted origin unmarked", () => {
    const request = new Request("http://localhost:23000/api/rpc", {
      method: "POST",
      headers: { origin: HOSTILE },
    });

    const response = Cors.apply(request, new Response(null, { status: 200 }));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
