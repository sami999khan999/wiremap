import { type JobOptions, QueuePublisher } from "../import.js";

export interface PublishedJob {
  readonly queue: string;
  readonly payload: unknown;
  readonly options: JobOptions | undefined;
}

// Records instead of enqueuing. "Published to the embedding queue, once, with this
// jobId" is the assertion a use-case test actually wants.
export class RecordingQueuePublisher extends QueuePublisher {
  private readonly jobs: PublishedJob[] = [];

  public override publish<T>(queue: string, payload: T, options?: JobOptions): Promise<void> {
    // `jobId` dedup is modelled, because it is a domain rule rather than queue
    // configuration — a use-case that publishes twice under one id is a bug.
    const duplicate =
      (options?.jobId !== undefined &&
        this.jobs.some((job) => job.options?.jobId === options.jobId)) ||
      (options?.onceWithin !== undefined &&
        this.jobs.some((job) => job.options?.onceWithin?.id === options.onceWithin?.id));

    if (!duplicate) this.jobs.push({ queue, payload, options });
    return Promise.resolve();
  }

  public published(): readonly PublishedJob[] {
    return this.jobs;
  }

  public publishedTo(queue: string): readonly PublishedJob[] {
    return this.jobs.filter((job) => job.queue === queue);
  }
}
