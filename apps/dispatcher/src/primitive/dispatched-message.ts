// One job, as the web app's `CloudflareQueuePublisher` sends it. The same shape is the
// queue message body, and the body of the callback minus the attempt counters.
export interface DispatchedMessage {
  readonly queue: string;
  readonly name: string;
  readonly id: string;
  readonly data: unknown;
  readonly maxAttempts: number;
  readonly delaySeconds?: number;
}

export class DispatchedMessages {
  private constructor() {}

  // Untrusted until shown otherwise, even signed: a bad shape is a 400, not a crash.
  public static parse(value: unknown): DispatchedMessage | null {
    if (typeof value !== "object" || value === null) return null;
    const message = value as Record<string, unknown>;
    if (typeof message.queue !== "string" || message.queue === "") return null;
    if (typeof message.name !== "string" || message.name === "") return null;
    if (typeof message.id !== "string" || message.id === "") return null;
    const maxAttempts = Number(message.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) return null;
    const delay = message.delaySeconds === undefined ? undefined : Number(message.delaySeconds);
    if (delay !== undefined && !(Number.isInteger(delay) && delay >= 0 && delay <= 43_200)) {
      return null;
    }
    return {
      queue: message.queue,
      name: message.name,
      id: message.id,
      data: message.data ?? null,
      maxAttempts,
      ...(delay ? { delaySeconds: delay } : {}),
    };
  }
}
