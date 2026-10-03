import { container } from "./container.js";

// The graph cap, so a PUT past it is refused while it streams rather than after.
const MAX_UPLOAD = 25 * 1024 * 1024;
const ROUTE = "/api/storage/";

// `/api/storage/<key>?exp=&sig=`: a signed link from `ProxiedStorageGateway`, for one method
// and one key. Answers 404 entirely unless the container runs storage proxied.
export class StorageEndpoint {
  private constructor() {}

  public static async handle(request: Request): Promise<Response> {
    const proxy = container.storageProxy;
    if (!proxy) return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const key = StorageEndpoint.keyFrom(url.pathname);
    const method = request.method === "PUT" ? "PUT" : request.method === "GET" ? "GET" : null;
    if (!key || !method) return new Response(null, { status: 404 });
    if (!proxy.verify(method, key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
      return new Response(null, { status: 403 });
    }
    return method === "GET" ? StorageEndpoint.read(key) : StorageEndpoint.write(key, request);
  }

  // One key, decoded segment by segment. No empty, `.` or `..` segment: a link signs one
  // object, and a path that walks is not that object.
  public static keyFrom(pathname: string): string | null {
    if (!pathname.startsWith(ROUTE)) return null;
    try {
      const segments = pathname
        .slice(ROUTE.length)
        .split("/")
        .map((segment) => decodeURIComponent(segment));
      return segments.some((segment) => segment === "" || segment === "." || segment === "..")
        ? null
        : segments.join("/");
    } catch {
      return null;
    }
  }

  // The first chunk is read before answering, so a missing object is a 404 and not a 200
  // whose body fails halfway.
  private static async read(key: string): Promise<Response> {
    const iterator = container.storage.getStream(key)[Symbol.asyncIterator]();
    let first: IteratorResult<Uint8Array>;
    try {
      first = await iterator.next();
    } catch {
      return new Response(null, { status: 404 });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!first.done) controller.enqueue(first.value);
        if (first.done) controller.close();
      },
      async pull(controller) {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    return new Response(body, {
      headers: {
        "content-type": key.endsWith(".json.gz") ? "application/gzip" : "application/octet-stream",
        "cache-control": "private, max-age=300",
      },
    });
  }

  private static async write(key: string, request: Request): Promise<Response> {
    if (!request.body) return new Response(null, { status: 400 });
    let size = 0;
    const reader = request.body.getReader();
    async function* capped() {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        size += value.byteLength;
        if (size > MAX_UPLOAD) throw new RangeError("too large");
        yield value;
      }
    }
    try {
      await container.storage.putStream(
        key,
        capped(),
        request.headers.get("content-type") ?? "application/octet-stream",
      );
    } catch (error) {
      if (error instanceof RangeError) {
        await container.storage.delete(key).catch(() => undefined);
        return new Response(null, { status: 413 });
      }
      throw error;
    }
    return new Response(null, { status: 200 });
  }
}
