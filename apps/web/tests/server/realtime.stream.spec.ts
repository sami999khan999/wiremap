import { AsyncLocalStorage } from "node:async_hooks";
import { Principal, RealtimeChannels } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import type { OrganizationId, RealtimeMessage, UserId } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { SilentLogger } from "@loadbearing/observability";
import { CapabilitySet } from "@loadbearing/permissions";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import { Cors } from "../../src/server/cors.js";
import { RealtimeRouter } from "../../src/server/import.js";

const ORG = "00000000-0000-7000-8000-000000000001" as OrganizationId;
const USER = "00000000-0000-7000-8000-000000000002" as UserId;
const CHANNEL = RealtimeChannels.user(ORG, USER);

// `ShardScope` is an `AsyncLocalStorage`, and `apps/web` does not depend on
// infrastructure — this is the same mechanism, which is what the wrap has to survive.
const shards = new AsyncLocalStorage<string>();
const PLACED = "node-0";

// The stream's whole surface of the container: a principal, a logger, and the port. A
// real one would need Postgres and both Redis instances to be constructed at all.
function containerWith(frames: readonly RealtimeMessage[], seen: string[]) {
  return {
    logger: new SilentLogger(),
    // What `shardMiddleware` calls. One node here, so placing is running the work —
    // the spec below asserts the *scope* survives, which is the part that can break.
    placed: <T>(_principal: Principal, work: () => Promise<T>) => shards.run(PLACED, work),
    principals: {
      fromHeaders: () => Promise.resolve(new Principal(ORG, USER, CapabilitySet.empty())),
    },
    realtimeSubscriber: {
      // eslint-disable-next-line @typescript-eslint/require-await
      subscribe: async function* (
        channels: readonly string[],
        _signal: AbortSignal,
        options?: { after?: string },
      ) {
        seen.push(...channels);
        if (options?.after) seen.push(`after:${options.after}`);
        for (const frame of frames) yield frame;
      },
    },
  } as unknown as Container;
}

const frame = (id: string): RealtimeMessage => ({
  kind: "event",
  id,
  name: "member.changed",
  at: new Date("2026-01-01T00:00:00Z"),
  payload: {},
});

async function call(container: Container, init: { lastEventId?: string } = {}): Promise<Response> {
  const handler = new RPCHandler({ realtime: RealtimeRouter.all });
  const headers = new Headers({ "content-type": "application/json" });
  if (init.lastEventId) headers.set("last-event-id", init.lastEventId);

  const { response } = await handler.handle(
    new Request("http://localhost/api/rpc/realtime/stream", {
      method: "POST",
      headers,
      body: "{}",
    }),
    { prefix: "/api/rpc", context: { container, headers } },
  );

  if (!response) throw new Error("the stream procedure did not match");
  return response;
}

describe("the realtime stream over RPCHandler", () => {
  it("answers as an event stream, not a JSON body", async () => {
    const response = await call(containerWith([], []));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("carries each published frame", async () => {
    const response = await call(containerWith([frame("00000000-0000-7000-8000-00000000000a")], []));
    const body = await response.text();

    expect(body).toContain("00000000-0000-7000-8000-00000000000a");
    // The id oRPC writes from `withEventMeta`, which is what the client sends back as
    // `Last-Event-ID` and what makes a reconnect a resume rather than a fresh open.
    expect(body).toContain("id: 00000000-0000-7000-8000-00000000000a");
  });

  // **The one that catches the broken shape**, and it needs three frames: a middleware
  // that only wrapped `next()` leaves every frame unplaced, frame zero included.
  it("holds the shard scope on every frame, not just the first", async () => {
    const perFrame: (string | undefined)[] = [];
    const container = containerWith([], []);

    // Reading the scope where the handler reads it: inside the generator, once per
    // frame, including before the first yield — `message.stream` reads there too.
    (container as { realtimeSubscriber: unknown }).realtimeSubscriber = {
      // eslint-disable-next-line @typescript-eslint/require-await
      subscribe: async function* () {
        perFrame.push(shards.getStore());
        yield frame("00000000-0000-7000-8000-00000000000a");
        perFrame.push(shards.getStore());
        yield frame("00000000-0000-7000-8000-00000000000b");
        perFrame.push(shards.getStore());
      },
    };

    await (await call(container)).text();

    expect(perFrame).toHaveLength(3);
    expect(perFrame).toEqual([PLACED, PLACED, PLACED]);
  });

  // The channel comes from the principal and from nothing else. An input that could
  // name one would be the whole of the tenancy hole.
  it("subscribes to the principal's own channel", async () => {
    const seen: string[] = [];
    await (await call(containerWith([], seen))).text();

    expect(seen).toEqual([CHANNEL]);
  });

  // `26.5`. The resume point goes to the subscriber, which replays what came after it or
  // answers `resync` when its log no longer reaches back; the router decides neither.
  it("hands a resumed stream's last event id to the subscriber", async () => {
    const seen: string[] = [];
    const response = await call(
      containerWith([frame("00000000-0000-7000-8000-00000000000b")], seen),
      { lastEventId: "00000000-0000-7000-8000-000000000099" },
    );
    const body = await response.text();

    expect(seen).toEqual([CHANNEL, "after:00000000-0000-7000-8000-000000000099"]);
    expect(body).toContain("00000000-0000-7000-8000-00000000000b");
  });

  // The buffering risk this whole tier exists to rule out: `Cors.apply` must set
  // headers and hand back the same streaming body, never read or replace it.
  it("survives Cors.apply with its body untouched", async () => {
    const response = await call(containerWith([frame("00000000-0000-7000-8000-00000000000c")], []));
    const request = new Request("http://localhost/api/rpc/realtime/stream", { method: "POST" });

    const applied = Cors.apply(request, response);

    expect(applied).toBe(response);
    expect(applied.headers.get("content-type")).toContain("text/event-stream");
    expect(await applied.text()).toContain("00000000-0000-7000-8000-00000000000c");
  });
  // `next()` resolves when the generator is *created*, so a throw from inside the body
  // never reached the catch. Every one was an opaque 500, logged nowhere.

  it("sends a throw from inside the stream through the error interceptor", async () => {
    const failures: unknown[] = [];
    const container = containerWith([], []);

    // `child()` returns itself, because `correlationMiddleware` logs through the child
    // and a fresh `SilentLogger` would drop every call this case is counting.
    const logger: unknown = Object.assign(new SilentLogger(), {
      failure: (error: unknown) => failures.push(error),
      child: () => logger,
    });
    (container as { logger: unknown }).logger = logger;
    (container as { realtimeSubscriber: unknown }).realtimeSubscriber = {
      // eslint-disable-next-line @typescript-eslint/require-await
      subscribe: async function* () {
        throw new ForbiddenError("realtime.stream");
        // biome-ignore lint/correctness/noUnreachable: a generator with no yield is not one.
        yield frame("00000000-0000-7000-8000-00000000000d");
      },
    };

    const body = await (await call(container)).text();

    expect(body).toContain("FORBIDDEN");
    expect(body).not.toContain("INTERNAL_SERVER_ERROR");
    expect(failures).toHaveLength(1);
  });
});

// `RV.1`. The check used to re-run with the principal captured at open, and asked only
// `conversation_members`, so a deactivated member kept receiving frames for thirty minutes.
describe("the conversation stream's revalidation", () => {
  const CONVERSATION = "00000000-0000-7000-8000-0000000000c1";

  function held(refreshed: Principal | null, watched: Principal[]): Container {
    const container = containerWith([], []);
    Object.assign(container, {
      principals: {
        fromHeaders: () => Promise.resolve(new Principal(ORG, USER, CapabilitySet.empty())),
        refresh: () => Promise.resolve(refreshed),
      },
      messaging: {
        watch: {
          execute: (principal: Principal) => {
            watched.push(principal);
            return Promise.resolve();
          },
        },
      },
      realtimeSubscriber: {
        // Open until the stream's own signal aborts, which is what a revocation does.
        subscribe: async function* (_channels: readonly string[], signal: AbortSignal) {
          yield frame("00000000-0000-7000-8000-00000000000e");
          await new Promise((resolve) => signal.addEventListener("abort", resolve));
        },
      },
    });
    return container;
  }

  async function open(container: Container): Promise<Response> {
    const handler = new RPCHandler({ realtime: RealtimeRouter.all });
    const { response } = await handler.handle(
      new Request("http://localhost/api/rpc/realtime/conversation", {
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
        body: JSON.stringify({ json: { conversationId: CONVERSATION } }),
      }),
      { prefix: "/api/rpc", context: { container, headers: new Headers() } },
    );
    if (!response) throw new Error("the conversation procedure did not match");
    return response;
  }

  it("ends the stream once the principal no longer resolves", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const body = (await open(held(null, []))).text();
      let ended = false;
      void body.then(() => {
        ended = true;
      });

      await vi.advanceTimersByTimeAsync(60_000);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the participant question with the re-read principal", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fresh = new Principal(ORG, USER, CapabilitySet.empty());
    const watched: Principal[] = [];
    try {
      void (await open(held(fresh, watched))).text();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(watched).toHaveLength(2);
      expect(watched[1]).toBe(fresh);
    } finally {
      vi.useRealTimers();
    }
  });
});
