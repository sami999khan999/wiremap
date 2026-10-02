import {
  type CacheStore,
  type JobOptions,
  type QueuedJob,
  QueuePublisher,
  Uuid,
} from "../import.js";
import { JobSignatureHasher } from "./job-signature.hasher.js";

export interface CloudflareQueueConfig {
  // The dispatcher Worker's origin; messages go to `<url>/enqueue`.
  readonly url: string;
  readonly secret: string;
}

// One message as the dispatcher receives it, and as `/api/internal/job` receives it back.
export interface DispatchedMessage {
  readonly queue: string;
  readonly name: string;
  readonly id: string;
  readonly data: unknown;
  readonly maxAttempts: number;
  readonly delaySeconds?: number;
}

// The BullMQ adapter's numbers, so a job retries the same on either host.
const DEFAULT_ATTEMPTS = 8;
// Cloudflare Queues takes at most 100 messages per `sendBatch`, and delays of 12 hours.
const BATCH = 100;
const MAX_DELAY_SECONDS = 12 * 60 * 60;
// How long a `jobId` stays claimed when the job set no retention of its own.
const JOB_ID_SECONDS = 24 * 60 * 60;
// Cloudflare cannot say when a job finishes, so "one while in flight" is approximated
// by a window longer than any job runs. See docs/reference/cloudflare-queue.md.
const IN_FLIGHT_SECONDS = 10 * 60;

// Publishes to Cloudflare Queues through the dispatcher Worker. Deduplication happens
// here, in the cache, because a Cloudflare queue has no job ids to collide on.
export class CloudflareQueuePublisher extends QueuePublisher {
  public constructor(
    private readonly config: CloudflareQueueConfig,
    private readonly cache: CacheStore,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  public override async publish<T>(queue: string, payload: T, options?: JobOptions): Promise<void> {
    await this.publishMany(queue, [{ payload, ...(options ? { options } : {}) }]);
  }

  public override async publishMany<T>(
    queue: string,
    jobs: readonly QueuedJob<T>[],
  ): Promise<void> {
    const claimed: string[] = [];
    const messages: DispatchedMessage[] = [];

    for (const job of jobs) {
      const key = await this.claim(queue, job.options);
      if (key === false) continue;
      if (key !== null) claimed.push(key);
      messages.push(CloudflareQueuePublisher.message(queue, job));
    }

    try {
      for (let index = 0; index < messages.length; index += BATCH) {
        await this.send(messages.slice(index, index + BATCH));
      }
    } catch (error) {
      // A claim for a message that never left would swallow the retry the caller makes.
      await Promise.all(claimed.map((key) => this.cache.delete(key)));
      throw error;
    }
  }

  // Nothing to close: every send is one request.
  public async close(): Promise<void> {}

  // `null` is no deduplication asked for; `false` is a duplicate to drop.
  private async claim(
    queue: string,
    options: JobOptions | undefined,
  ): Promise<string | null | false> {
    const rule = CloudflareQueuePublisher.dedup(options);
    if (!rule) return null;
    const key = `queue:dedup:${queue}:${rule.id}`;
    return (await this.cache.setIfAbsent(key, 1, rule.seconds)) ? key : false;
  }

  private async send(messages: readonly DispatchedMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const body = JSON.stringify({ messages });
    const response = await this.fetcher(`${this.config.url.replace(/\/$/, "")}/enqueue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...JobSignatureHasher.headers(this.config.secret, this.now(), body),
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Dispatcher refused ${messages.length} message(s): ${response.status}`);
    }
  }

  private static dedup(
    options: JobOptions | undefined,
  ): { readonly id: string; readonly seconds: number } | null {
    if (options?.onceWithin) return options.onceWithin;
    if (options?.inFlightId) return { id: options.inFlightId, seconds: IN_FLIGHT_SECONDS };
    if (options?.jobId) {
      return { id: options.jobId, seconds: options.removeOnCompleteAgeSeconds ?? JOB_ID_SECONDS };
    }
    return null;
  }

  // `priority` has no Cloudflare equivalent and is dropped: a queue is still the priority
  // boundary, which is what the port documents it as.
  private static message<T>(queue: string, job: QueuedJob<T>): DispatchedMessage {
    const options = job.options;
    const delay =
      options?.delayMs === undefined
        ? undefined
        : Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.ceil(options.delayMs / 1000)));
    return {
      queue,
      name: options?.name ?? queue,
      id: options?.jobId ?? Uuid.v7(),
      data: job.payload,
      maxAttempts: options?.attempts ?? DEFAULT_ATTEMPTS,
      ...(delay ? { delaySeconds: delay } : {}),
    };
  }
}
