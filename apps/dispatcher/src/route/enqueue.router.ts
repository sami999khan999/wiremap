import type { Env } from "../env.js";
import {
  type DispatchedMessage,
  DispatchedMessages,
  JobSignatureHasher,
} from "../primitive/index.js";

// Cloudflare takes at most 100 messages per `sendBatch`.
const BATCH = 100;

// `POST /enqueue` from the web app, and a health check. Nothing else is served.
export class EnqueueRouter {
  private constructor() {}

  public static async handle(
    request: Request,
    env: Env,
    now: number = Date.now(),
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") return new Response("ok");
    if (request.method !== "POST" || pathname !== "/enqueue") {
      return new Response(null, { status: 404 });
    }

    const body = await request.text();
    const verified = await JobSignatureHasher.verify(
      env.DISPATCHER_SECRET,
      request.headers.get(JobSignatureHasher.TIMESTAMP_HEADER),
      request.headers.get(JobSignatureHasher.SIGNATURE_HEADER),
      body,
      now,
    );
    if (!verified) return new Response(null, { status: 401 });

    const messages = EnqueueRouter.parse(body);
    if (!messages) return new Response(null, { status: 400 });

    for (let index = 0; index < messages.length; index += BATCH) {
      await env.JOBS.sendBatch(
        messages.slice(index, index + BATCH).map((message) => ({
          body: message,
          ...(message.delaySeconds ? { delaySeconds: message.delaySeconds } : {}),
        })),
      );
    }
    return new Response(null, { status: 202 });
  }

  // All or nothing: one malformed message refuses the request, so the publisher's retry
  // is not left to guess which half went through.
  private static parse(body: string): DispatchedMessage[] | null {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
    const raw = (value as { messages?: unknown } | null)?.messages;
    if (!Array.isArray(raw)) return null;
    const messages: DispatchedMessage[] = [];
    for (const item of raw) {
      const message = DispatchedMessages.parse(item);
      if (!message) return null;
      messages.push(message);
    }
    return messages;
  }
}
