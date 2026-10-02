// What every host hands a consumer: BullMQ's `Job` in the worker, a signed request body
// on `/api/internal/job`. A consumer reads only these fields, so it runs the same in both.
export interface QueueJob {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
  // One-based: the first delivery is attempt 1.
  readonly attempt: number;
  readonly maxAttempts: number;
}
