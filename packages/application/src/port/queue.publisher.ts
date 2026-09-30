export interface JobOptions {
  readonly delayMs?: number;
  readonly attempts?: number;
  // Idempotency is a domain rule ("enqueue OCR for this receipt, once"), not queue
  // configuration. **No `:`** — BullMQ keys on it and rejects the job at publish time.
  readonly jobId?: string;
  // One job per id **while one is waiting or running**, and free again once it finishes.
  // An operator's request wants this: `jobId` swallowed a retry for a day (`CR.18`).
  readonly inFlightId?: string;
  // One job per id for this long from the first, finished or not. Mail wants this: `jobId`
  // holds only while the completed job is kept, and a count cap trims it early (`RV.5`).
  readonly onceWithin?: { readonly id: string; readonly seconds: number };
  // Lower runs first. A queue is a priority boundary, so this orders work *within* one
  // queue — a mail nobody can sign up without, ahead of a digest nobody is waiting on.
  readonly priority?: number;
  // The job name a consumer switches on. Defaults to the queue name, which is what every
  // single-job-kind queue wants and what a queue carrying two kinds of work cannot use.
  readonly name?: string;
  // How long a completed job stays keyed, as an upper bound only: the adapter also caps
  // the set by count, and any job completing on the queue trims it. See consumers.md.
  readonly removeOnCompleteAgeSeconds?: number;
}

export interface QueuedJob<T> {
  readonly payload: T;
  readonly options?: JobOptions;
}

export abstract class QueuePublisher {
  public abstract publish<T>(queue: string, payload: T, options?: JobOptions): Promise<void>;

  // Many jobs for one queue. The default is one publish each; an adapter that can send
  // them in one round trip overrides it, which is the whole reason a fan-out calls this.
  public async publishMany<T>(queue: string, jobs: readonly QueuedJob<T>[]): Promise<void> {
    for (const job of jobs) await this.publish(queue, job.payload, job.options);
  }
}
