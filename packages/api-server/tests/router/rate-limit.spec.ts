import { Principal } from "@loadbearing/application";
import { type Container, InMemoryRateLimitStore } from "@loadbearing/composition";
import { ProcedurePermissions } from "@loadbearing/contracts";
import { SilentLogger } from "@loadbearing/observability";
import { CapabilitySet } from "@loadbearing/permissions";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it } from "vitest";
import { authed } from "../../src/router/base.js";
import { RateLimitPolicy } from "../../src/router/rate-limit.policy.js";

const ORG = "00000000-0000-7000-8000-000000000001";
const ALICE = "00000000-0000-7000-8000-000000000002";
const BOB = "00000000-0000-7000-8000-000000000003";

// `document.search` is limited and costs a paid embedding call; `document.index` sits
// beside it so a count on one path is seen not to reach the other.
const router = {
  document: {
    search: authed.document.search.handler(() => ({ hits: [] })),
    index: authed.document.index.handler(() => ({ documentId: "d" })),
  },
};

function containerFor(rateLimits: InMemoryRateLimitStore, user: string): Container {
  return {
    logger: new SilentLogger(),
    placed: <T>(_principal: Principal, work: () => Promise<T>) => work(),
    principals: {
      fromHeaders: () =>
        Promise.resolve(new Principal(ORG as never, user as never, CapabilitySet.empty())),
    },
    rateLimits,
  } as unknown as Container;
}

async function search(container: Container): Promise<number> {
  const handler = new RPCHandler(router);
  const headers = new Headers({ "content-type": "application/json" });
  const { response } = await handler.handle(
    new Request("http://localhost/api/rpc/document/search", {
      method: "POST",
      headers,
      body: JSON.stringify({ json: { query: "q", limit: 5 } }),
    }),
    { prefix: "/api/rpc", context: { container, headers } },
  );
  return response?.status ?? 0;
}

// `CR.6`. Nothing on the oRPC surface was limited: an invitation could mail-bomb any
// address, and every search was a paid call.
describe("the rate limit in the authed chain", () => {
  it("refuses a principal past its limit on a limited procedure, with a 429", async () => {
    const store = new InMemoryRateLimitStore();
    const alice = containerFor(store, ALICE);
    const { limit } = RateLimitPolicy.for("document.search") ?? { limit: 0 };

    for (let call = 0; call < limit; call += 1) expect(await search(alice)).toBe(200);
    expect(await search(alice)).toBe(429);
  });

  it("counts per person, so one person's limit is nobody else's", async () => {
    const store = new InMemoryRateLimitStore();
    const { limit } = RateLimitPolicy.for("document.search") ?? { limit: 0 };
    for (let call = 0; call <= limit; call += 1) await search(containerFor(store, ALICE));

    expect(await search(containerFor(store, BOB))).toBe(200);
  });

  it("lets a call through when the counter cannot be reached", async () => {
    const down = {
      hit: () => Promise.reject(new Error("cache down")),
    } as unknown as InMemoryRateLimitStore;

    expect(await search(containerFor(down, ALICE))).toBe(200);
  });
});

// A limit keyed on a path that was renamed limits nothing, and says nothing about it.
describe("RateLimitPolicy", () => {
  it("names only procedures that exist", () => {
    for (const procedure of RateLimitPolicy.procedures()) {
      expect(ProcedurePermissions.required(procedure), procedure).toBeDefined();
    }
  });
});
