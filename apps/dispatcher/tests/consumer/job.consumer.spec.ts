import { describe, expect, it } from "vitest";
import { JobConsumer } from "../../src/consumer/index.js";
import { type DispatchedMessage, JobSignatureHasher } from "../../src/primitive/index.js";
import { testEnv } from "../support.js";

class FakeMessage {
  public outcome: "acked" | { retry: number } | null = null;
  public readonly id = "m";
  public readonly timestamp = new Date();

  public constructor(
    public readonly body: DispatchedMessage,
    public readonly attempts: number,
  ) {}

  public ack(): void {
    this.outcome = "acked";
  }

  public retry(options?: { delaySeconds?: number }): void {
    this.outcome = { retry: options?.delaySeconds ?? 0 };
  }
}

const job: DispatchedMessage = {
  queue: "mail",
  name: "send",
  id: "j1",
  data: { a: 1 },
  maxAttempts: 3,
};

function run(status: number, attempts: number) {
  const { env, dead } = testEnv();
  const requests: Request[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push(new Request(url, init));
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  const message = new FakeMessage(job, attempts);
  const batch = {
    queue: "wiremap-jobs",
    messages: [message],
  } as unknown as MessageBatch<DispatchedMessage>;
  return { done: JobConsumer.handle(batch, env, fetcher), message, requests, dead };
}

describe("JobConsumer", () => {
  it("posts a signed delivery to the web app and acks on 2xx", async () => {
    const { done, message, requests } = run(204, 1);
    await done;

    expect(message.outcome).toBe("acked");
    const [request] = requests;
    expect(request?.url).toBe("https://web.example.test/api/internal/job");
    const body = (await request?.text()) ?? "";
    expect(JSON.parse(body)).toEqual({
      queue: "mail",
      id: "j1",
      name: "send",
      data: { a: 1 },
      attempt: 1,
      maxAttempts: 3,
    });
    expect(
      await JobSignatureHasher.verify(
        "i".repeat(32),
        request?.headers.get(JobSignatureHasher.TIMESTAMP_HEADER) ?? null,
        request?.headers.get(JobSignatureHasher.SIGNATURE_HEADER) ?? null,
        body,
        Date.now(),
      ),
    ).toBe(true);
  });

  it("retries a failure with a doubling delay", async () => {
    const { done, message } = run(500, 2);
    await done;

    expect(message.outcome).toEqual({ retry: 10 });
  });

  it("dead-letters a message on its last attempt instead of retrying", async () => {
    const { done, message, dead } = run(500, 3);
    await done;

    expect(message.outcome).toBe("acked");
    expect(dead.sent.map((sent) => sent.body.id)).toEqual(["j1"]);
  });

  it("caps the backoff at an hour", () => {
    expect(JobConsumer.backoff(1)).toBe(5);
    expect(JobConsumer.backoff(30)).toBe(3_600);
  });
});
