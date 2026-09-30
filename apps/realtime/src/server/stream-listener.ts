import {
  CORSPlugin,
  type Container,
  createServer,
  type IncomingMessage,
  RealtimeRouter,
  RPCHandler,
  type Server,
  type ServerResponse,
} from "../import.js";

// The path the browser's client sends every `realtime.*` procedure to. Same origin as the
// app, so the session cookie rides along; the proxy in front is what splits the two.
const PREFIX = "/api/realtime";

// The same fifteen seconds the web app's handler uses, well inside any proxy's idle timeout.
const KEEP_ALIVE_MS = 15_000;

const ALLOWED_HEADERS = ["content-type", "authorization", "x-api-key", "last-event-id"];

// The HTTP adapter, and the only one in this process. `api-server` holds the router; this
// holds the socket, the prefix and the probe.
export class StreamListener {
  private readonly handler;
  private readonly server: Server;
  // Settles when `close()` has seen the last connection go; resolved until a stop begins.
  private shut: Promise<void> = Promise.resolve();

  public constructor(
    private readonly container: Container,
    trustedOrigins: readonly string[],
  ) {
    this.handler = new RPCHandler(
      { realtime: RealtimeRouter.all },
      {
        eventIteratorKeepAliveInterval: KEEP_ALIVE_MS,
        // For the desktop shell, which calls cross-origin. The web app is same-origin and
        // never needs it; the list is the one the web app's CORS layer reads.
        plugins: [
          new CORSPlugin({
            origin: (origin: string) => (trustedOrigins.includes(origin) ? origin : null),
            credentials: true,
            allowHeaders: ALLOWED_HEADERS,
          }),
        ],
      },
    );
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  public listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  // No new connections, and idle ones dropped. Open streams keep going until drained.
  public stopAccepting(): void {
    this.shut = new Promise((resolve) => {
      this.server.close(() => resolve());
    });
    this.server.closeIdleConnections();
  }

  // Resolves once every connection has closed, or after `withinMs`. A drained stream still
  // has its last frame to write, and a response that finishes leaves its socket idle.
  // ──
  // Measured on Linux (`CP7.5`): cutting at once, the last stream to drain lost its final
  // frame, so its client saw a socket error rather than a clean end, and backed off.
  public closed(withinMs: number): Promise<void> {
    const sweep = setInterval(() => this.server.closeIdleConnections(), 50);
    let limit: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      limit = setTimeout(resolve, withinMs);
    });
    return Promise.race([this.shut, budget]).finally(() => {
      clearInterval(sweep);
      clearTimeout(limit);
    });
  }

  // Whatever the drain left open, cut. A client treats that as an error and backs off.
  public closeAll(): void {
    this.server.closeAllConnections();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Liveness only, deliberately: a probe that reported Redis would restart every replica
    // at once over a blip their streams already survive by reconnecting.
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    try {
      const { matched } = await this.handler.handle(request, response, {
        prefix: PREFIX,
        context: { container: this.container, headers: StreamListener.headersOf(request) },
      });
      if (!matched) response.writeHead(404).end();
    } catch (error: unknown) {
      this.container.logger.failure(error, { service: "realtime", path: request.url ?? "" });
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }

  // The principal is resolved from these exactly as the web app resolves it from a fetch
  // `Request`: the cookie for the browser, `authorization` or `x-api-key` for the rest.
  private static headersOf(request: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
    }
    return headers;
  }
}
