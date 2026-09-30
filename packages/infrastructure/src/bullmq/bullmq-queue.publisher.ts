import { type JobOptions, Queue, type QueuedJob, QueuePublisher, type Redis } from "../import.js";

// Eight attempts doubling from five seconds wait about ten minutes in all: long enough to
// outlast a failover or a provider blip, where three from two seconds gave up in six.
const DEFAULT_ATTEMPTS = 8;
const BACKOFF = Object.freeze({ type: "exponential", delay: 5_000, jitter: 0.5 });
// A failed job is the dead letter: kept a week so it can be found and replayed, and
// capped, because the queue instance is `noeviction` and a failure storm must not fill it.
const FAILED_KEEP = Object.freeze({ age: 7 * 86_400, count: 10_000 });
const BULK_CHUNK = 500;

export class BullMqQueuePublisher extends QueuePublisher {
  private readonly queues = new Map<string, Queue>();

  public constructor(private readonly connection: Redis) {
    super();
  }

  public override async publish<T>(queue: string, payload: T, options?: JobOptions): Promise<void> {
    // The queue name is the default job name, which is what a queue carrying one kind
    // of work wants; a consumer that switches on `job.name` passes its own.
    await this.queueFor(queue).add(
      options?.name ?? queue,
      payload,
      BullMqQueuePublisher.opts(options),
    );
  }

  // `addBulk`, one round trip per chunk: a fan-out to five hundred recipients was five
  // hundred sequential `add`s. Chunked so one call never builds an unbounded pipeline.
  public override async publishMany<T>(
    queue: string,
    jobs: readonly QueuedJob<T>[],
  ): Promise<void> {
    const target = this.queueFor(queue);
    for (let index = 0; index < jobs.length; index += BULK_CHUNK) {
      await target.addBulk(
        jobs.slice(index, index + BULK_CHUNK).map((job) => ({
          name: job.options?.name ?? queue,
          data: job.payload,
          opts: BullMqQueuePublisher.opts(job.options),
        })),
      );
    }
  }

  private static opts(options: JobOptions | undefined) {
    return {
      delay: options?.delayMs,
      attempts: options?.attempts ?? DEFAULT_ATTEMPTS,
      priority: options?.priority,
      // The deduplication key, from the port: "enqueue OCR for this receipt, once"
      // is a business rule, not queue configuration.
      jobId: options?.jobId,
      // BullMQ's simple mode: the key is released when the job completes or fails, so a
      // repeat request after the first has finished is a new job rather than a no-op.
      ...(options?.inFlightId === undefined ? {} : { deduplication: { id: options.inFlightId } }),
      // Throttle mode: the key is its own Redis entry with a TTL, so it outlives the job.
      ...(options?.onceWithin === undefined
        ? {}
        : {
            deduplication: { id: options.onceWithin.id, ttl: options.onceWithin.seconds * 1_000 },
          }),
      // Jittered, so the jobs one outage failed together do not all retry together.
      backoff: { ...BACKOFF },
      // Mandatory, not tuning. BullMQ keeps completed jobs forever by default, and
      // on a `noeviction` instance that ends with everything stopping.
      removeOnComplete: { age: options?.removeOnCompleteAgeSeconds ?? 3_600, count: 1_000 },
      removeOnFail: { ...FAILED_KEEP },
    };
  }

  private queueFor(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const created = new Queue(name, { connection: this.connection });
    this.queues.set(name, created);
    return created;
  }

  public async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}
