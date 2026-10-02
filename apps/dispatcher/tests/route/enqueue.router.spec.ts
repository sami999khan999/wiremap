import { describe, expect, it } from "vitest";
import { JobSignatureHasher } from "../../src/primitive/index.js";
import { EnqueueRouter } from "../../src/route/index.js";
import { testEnv } from "../support.js";

const NOW = 1_800_000_000_000;

async function post(body: string, secret = "d".repeat(32)): Promise<Request> {
  return new Request("https://dispatch.example.test/enqueue", {
    method: "POST",
    headers: await JobSignatureHasher.headers(secret, NOW, body),
    body,
  });
}

const message = (id: string, extra: object = {}) => ({
  queue: "mail",
  name: "send",
  id,
  data: { to: "a@example.test" },
  maxAttempts: 8,
  ...extra,
});

describe("EnqueueRouter", () => {
  it("queues a signed batch, carrying each message's delay", async () => {
    const { env, jobs } = testEnv();
    const body = JSON.stringify({ messages: [message("a"), message("b", { delaySeconds: 30 })] });

    const response = await EnqueueRouter.handle(await post(body), env, NOW);

    expect(response.status).toBe(202);
    expect(jobs.sent.map((sent) => [sent.body.id, sent.delaySeconds])).toEqual([
      ["a", undefined],
      ["b", 30],
    ]);
  });

  it("refuses an unsigned or wrongly signed request", async () => {
    const { env, jobs } = testEnv();
    const body = JSON.stringify({ messages: [message("a")] });

    expect((await EnqueueRouter.handle(await post(body, "x".repeat(32)), env, NOW)).status).toBe(
      401,
    );
    expect(jobs.sent).toEqual([]);
  });

  // One bad message refuses the whole request, so the publisher's retry is unambiguous.
  it("refuses the whole batch when one message is malformed", async () => {
    const { env, jobs } = testEnv();
    const body = JSON.stringify({ messages: [message("a"), { queue: "mail" }] });

    expect((await EnqueueRouter.handle(await post(body), env, NOW)).status).toBe(400);
    expect(jobs.sent).toEqual([]);
  });

  it("serves a health check and nothing else", async () => {
    const { env } = testEnv();

    expect((await EnqueueRouter.handle(new Request("https://d.test/health"), env)).status).toBe(
      200,
    );
    expect((await EnqueueRouter.handle(new Request("https://d.test/other"), env)).status).toBe(404);
  });
});
