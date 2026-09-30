import { InternalError } from "@loadbearing/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BearerAuthStrategy } from "../../src/auth/bearer-auth.strategy.js";
import { CookieAuthStrategy } from "../../src/auth/cookie-auth.strategy.js";
import { TokenProvider } from "../../src/auth/token.provider.js";
import { ApiClient } from "../../src/client/api-client.js";

class StaticTokenProvider extends TokenProvider {
  public constructor(private readonly token: string | null) {
    super();
  }

  public override get(): Promise<string | null> {
    return Promise.resolve(this.token);
  }

  public override set(): Promise<void> {
    return Promise.resolve();
  }
}

// The client is a proxy, so any path reaches the link. What the strategy puts on the
// wire is the part under test, not what the server answers.
interface ProbeClient {
  readonly probe: (input: unknown) => Promise<unknown>;
}

interface Captured {
  readonly url: string;
  readonly credentials: unknown;
  readonly authorization: string | null;
}

const realFetch = globalThis.fetch;
let captured: Captured | null = null;

// Captures and then fails, deliberately. Returning a well-formed RPC response would
// mean encoding oRPC's wire format in a spec, which is testing the library.
const capturingFetch = (request: Request, init?: RequestInit): Promise<Response> => {
  captured = {
    url: request.url,
    credentials: init?.credentials,
    authorization: request.headers.get("authorization"),
  };
  return Promise.reject(new Error("captured"));
};

const callThrough = async (client: ApiClient): Promise<void> => {
  const probe = client.raw as unknown as ProbeClient;
  await expect(probe.probe({ ok: true })).rejects.toThrow();
};

afterEach(() => {
  globalThis.fetch = realFetch;
  captured = null;
});

describe("ApiClient.overHttp", () => {
  it("sends the cookie and no authorization header under CookieAuthStrategy", async () => {
    globalThis.fetch = capturingFetch as typeof globalThis.fetch;

    await callThrough(ApiClient.overHttp("https://api.test/rpc", new CookieAuthStrategy()));

    expect(captured?.credentials).toBe("include");
    expect(captured?.authorization).toBeNull();
  });

  it("sends the bearer token and omits the cookie under BearerAuthStrategy", async () => {
    globalThis.fetch = capturingFetch as typeof globalThis.fetch;

    await callThrough(
      ApiClient.overHttp(
        "https://api.test/rpc",
        new BearerAuthStrategy(new StaticTokenProvider("abc123")),
      ),
    );

    expect(captured?.credentials).toBe("omit");
    expect(captured?.authorization).toBe("Bearer abc123");
  });

  it("reaches the configured base url", async () => {
    globalThis.fetch = capturingFetch as typeof globalThis.fetch;

    await callThrough(ApiClient.overHttp("https://api.test/rpc", new CookieAuthStrategy()));

    expect(captured?.url.startsWith("https://api.test/rpc")).toBe(true);
  });

  // `CP7.6`: one namespace is one process. Streams go to the stream process, and every
  // other procedure stays on the web app.
  it("sends a realtime procedure to the stream url and anything else to the base", async () => {
    globalThis.fetch = capturingFetch as typeof globalThis.fetch;
    const client = ApiClient.overHttp(
      "https://app.test/api/rpc",
      new CookieAuthStrategy(),
      "https://app.test/api/realtime",
    );
    const raw = client.raw as unknown as {
      realtime: { probe: (input: unknown) => Promise<unknown> };
    };

    await expect(raw.realtime.probe({})).rejects.toThrow();
    expect(captured?.url.startsWith("https://app.test/api/realtime/realtime/probe")).toBe(true);

    await callThrough(client);
    expect(captured?.url.startsWith("https://app.test/api/rpc/probe")).toBe(true);
  });
});

describe("ApiClient.overHttp rejects a base Node cannot resolve", () => {
  it("throws at construction rather than at the first call", () => {
    // The failure this replaces is a `TypeError: Invalid URL` raised inside a route
    // loader, several frames from the line that chose the transport.
    expect(() =>
      ApiClient.overHttp("/api/rpc", new BearerAuthStrategy(new StaticTokenProvider("t"))),
    ).toThrow(InternalError);
  });

  it("keeps the diagnostic on `cause`, so the code is still the message", () => {
    try {
      ApiClient.overHttp("/api/rpc", new BearerAuthStrategy(new StaticTokenProvider("t")));
      expect.unreachable("a relative base must not construct under Node");
    } catch (error) {
      // The envelope stays wordless; the sentence naming the fix reaches the logger.
      expect((error as InternalError).message).toBe("INTERNAL");
      expect(((error as InternalError).cause as Error).message).toContain("ApiClient.inProcess");
    }
  });

  it("allows a relative base in a browser, where it is the correct thing to pass", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } });

    expect(() =>
      ApiClient.overHttp("/api/rpc", new BearerAuthStrategy(new StaticTokenProvider("t"))),
    ).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("allows an absolute base under Node, which is what a cross-process caller passes", () => {
    expect(() =>
      ApiClient.overHttp(
        "https://api.test/rpc",
        new BearerAuthStrategy(new StaticTokenProvider("t")),
      ),
    ).not.toThrow();
  });
});

describe("ApiClient.inProcess", () => {
  it("hands back the injected client without touching the network", async () => {
    globalThis.fetch = (() => {
      throw new Error("inProcess must not reach fetch.");
    }) as typeof globalThis.fetch;

    const injected = { probe: () => Promise.resolve("from the router") };
    const client = ApiClient.inProcess(injected as never);

    expect(client.raw).toBe(injected);
    await expect((client.raw as unknown as ProbeClient).probe({})).resolves.toBe("from the router");
  });
});
