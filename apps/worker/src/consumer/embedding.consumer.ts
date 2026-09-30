import { SystemPrincipal, withShard } from "../bootstrap/index.js";
import { type Container, type Job, QueueName, type Redis, Worker } from "../import.js";

interface EmbeddingJobData {
  readonly organizationId: string;
  readonly documentId: string;
  readonly text: string;
  readonly goalId?: string | null;
  readonly sourceType?: string;
  // Absent on a job queued before `CR.33`, which then indexes unconditionally.
  readonly version?: number;
}

// A thin adapter, exactly like an oRPC router. Everything worth testing lives in
// `IndexDocumentUseCase`.
export class EmbeddingConsumer {
  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
    private readonly concurrency: number,
  ) {}

  public start(): Worker {
    const worker = new Worker<EmbeddingJobData>(
      QueueName.EMBEDDING,
      async (job: Job<EmbeddingJobData>) => this.handle(job),
      { connection: this.connection, concurrency: this.concurrency },
    );

    // From the event, never a `catch` in the handler: the listener does not swallow, so
    // BullMQ still sees the rejection and still retries.
    worker.on("failed", (job, error) => {
      // Two lines, and they answer different questions. This one is the countable
      // signal: one `event_code`, so queue health is a rate rather than a grep.
      this.container.logger.emit("queue.job.failed", {
        queue: QueueName.EMBEDDING,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });

      // And this one is the diagnosis — normalised code, cause and stack, at the level
      // the error catalog decides.
      this.container.logger.failure(error, {
        queue: QueueName.EMBEDDING,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });
    });

    worker.on("completed", (job) => {
      this.container.logger.emit("queue.job.completed", {
        queue: QueueName.EMBEDDING,
        jobId: job.id ?? "unknown",
        durationMs: Math.max(0, (job.finishedOn ?? 0) - (job.processedOn ?? 0)),
      });
    });

    worker.on("stalled", (jobId) => {
      this.container.logger.emit("queue.job.stalled", { queue: QueueName.EMBEDDING, jobId });
    });

    return worker;
  }

  // Let it throw: BullMQ's retry is driven by rejection, so catching here turns a
  // retryable failure into permanent, silent data loss.
  public async handle(job: Job<EmbeddingJobData>): Promise<void> {
    const principal = SystemPrincipal.forOrganization(job.data.organizationId);

    // `document_chunks` is routed, so the job is placed before the use-case runs.
    await withShard(this.container, job.data.organizationId, () =>
      this.container.ai.indexDocument.execute(principal, {
        documentId: job.data.documentId,
        text: job.data.text,
        goalId: job.data.goalId ?? null,
        sourceType: job.data.sourceType ?? "document",
        ...(job.data.version === undefined ? {} : { version: job.data.version }),
      }),
    );
  }
}
