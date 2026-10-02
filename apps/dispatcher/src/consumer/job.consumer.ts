import type { Env } from "../env.js";
import { type DispatchedMessage, JobSignatureHasher } from "../primitive/index.js";

// Doubling from five seconds, as the BullMQ adapter does, capped at an hour.
const FIRST_RETRY_SECONDS = 5;
const MAX_RETRY_SECONDS = 3_600;

// Hands each queue message to the web app, which runs the consumer in Node. This Worker
// only waits on the network, which is what keeps it inside the free plan's CPU limit.
export class JobConsumer {
  private constructor() {}

  public static async handle(
    batch: MessageBatch<DispatchedMessage>,
    env: Env,
    fetcher: typeof fetch = fetch,
  ): Promise<void> {
    await Promise.all(batch.messages.map((message) => JobConsumer.deliver(message, env, fetcher)));
  }

  private static async deliver(
    message: Message<DispatchedMessage>,
    env: Env,
    fetcher: typeof fetch,
  ): Promise<void> {
    const job = message.body;
    const body = JSON.stringify({
      queue: job.queue,
      id: job.id,
      name: job.name,
      data: job.data,
      attempt: message.attempts,
      maxAttempts: job.maxAttempts,
    });

    let status = 0;
    try {
      const response = await fetcher(`${env.WEB_URL.replace(/\/$/, "")}/api/internal/job`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await JobSignatureHasher.headers(env.INTERNAL_JOB_SECRET, Date.now(), body)),
        },
        body,
      });
      status = response.status;
    } catch {
      status = 0;
    }

    if (status >= 200 && status < 300) {
      message.ack();
      return;
    }

    if (message.attempts >= job.maxAttempts) {
      await env.DEAD.send(job);
      message.ack();
      JobConsumer.log("queue.job.dead", job, message.attempts, status);
      return;
    }

    message.retry({ delaySeconds: JobConsumer.backoff(message.attempts) });
    JobConsumer.log("queue.job.retried", job, message.attempts, status);
  }

  public static backoff(attempts: number): number {
    return Math.min(MAX_RETRY_SECONDS, FIRST_RETRY_SECONDS * 2 ** Math.max(0, attempts - 1));
  }

  // One JSON line, which Workers Logs indexes; the payload is never logged.
  private static log(code: string, job: DispatchedMessage, attempt: number, status: number): void {
    // biome-ignore lint/suspicious/noConsole: a Worker's console is its log stream
    console.log(
      JSON.stringify({
        event_code: code,
        queue: job.queue,
        name: job.name,
        id: job.id,
        attempt,
        status,
      }),
    );
  }
}
