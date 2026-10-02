import type { Env } from "../src/env.js";
import type { DispatchedMessage } from "../src/primitive/index.js";

export interface SentBatch {
  readonly body: DispatchedMessage;
  readonly delaySeconds?: number;
}

// A queue binding that records what it was given.
export class RecordingQueue {
  public readonly sent: SentBatch[] = [];

  public async send(body: DispatchedMessage): Promise<void> {
    this.sent.push({ body });
  }

  public async sendBatch(messages: Iterable<SentBatch>): Promise<void> {
    for (const message of messages) this.sent.push(message);
  }
}

export function testEnv() {
  const jobs = new RecordingQueue();
  const dead = new RecordingQueue();
  const env = {
    JOBS: jobs,
    DEAD: dead,
    WEB_URL: "https://web.example.test/",
    DISPATCHER_SECRET: "d".repeat(32),
    INTERNAL_JOB_SECRET: "i".repeat(32),
  } as unknown as Env;
  return { env, jobs, dead };
}
