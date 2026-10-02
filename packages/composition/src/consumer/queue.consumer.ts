import type { Container } from "../container/index.js";
import type { QueueJob } from "./queue-job.js";
import { SystemPrincipal } from "./system-principal.js";

// One queue's unit of work, hosted by whatever delivers it. A thin adapter like an oRPC
// router: everything worth testing lives in the use-cases it calls.
export abstract class QueueConsumer {
  public constructor(protected readonly container: Container) {}

  public abstract readonly queue: string;

  // Let it throw. Every host retries on rejection, so catching here turns a retryable
  // failure into permanent, silent loss.
  public abstract handle(job: QueueJob): Promise<void>;

  // Two lines, answering different questions: the countable signal, then the diagnosis.
  public failed(job: QueueJob, error: unknown): void {
    this.container.logger.emit("queue.job.failed", {
      queue: this.queue,
      jobId: job.id,
      attempt: job.attempt,
    });
    this.container.logger.failure(error, {
      queue: this.queue,
      jobId: job.id,
      attempt: job.attempt,
    });
  }

  public completed(job: QueueJob, durationMs: number): void {
    this.container.logger.emit("queue.job.completed", {
      queue: this.queue,
      jobId: job.id,
      durationMs: Math.max(0, durationMs),
    });
  }

  // A job that names a tenant is placed before its use-case runs. `recheck`, because a
  // job can still be opening transactions after a move's settle.
  protected placed<T>(
    organizationId: string,
    work: () => Promise<T>,
    options: { readonly replica?: boolean } = {},
  ): Promise<T> {
    return this.container.placed(SystemPrincipal.forOrganization(organizationId), work, {
      recheck: true,
      replica: options.replica,
    });
  }
}
