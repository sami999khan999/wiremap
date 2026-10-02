import { Env } from "~/env.js";
import { container } from "./container.js";
import { ConsumerRegistry, JobSignatureHasher, type QueueJob } from "./import.js";

interface Delivery extends QueueJob {
  readonly queue: string;
}

// Built once, beside the container it reads.
const registry = new ConsumerRegistry(container);

// A delivery from the dispatcher Worker: verify, run, and answer so it knows whether to
// retry. 2xx acknowledges; anything else is retried with backoff, then dead-lettered.
export class JobEndpoint {
  private constructor() {}

  public static async handle(request: Request): Promise<Response> {
    const secret = Env.internalJobSecret;
    if (!secret) return new Response(null, { status: 404 });

    const body = await request.text();
    const verified = JobSignatureHasher.verify(
      secret,
      request.headers.get(JobSignatureHasher.TIMESTAMP_HEADER),
      request.headers.get(JobSignatureHasher.SIGNATURE_HEADER),
      body,
      Date.now(),
    );
    if (!verified) return new Response(null, { status: 401 });

    const delivery = JobEndpoint.parse(body);
    if (!delivery) return new Response(null, { status: 400 });

    const { queue, ...job } = delivery;
    try {
      await registry.run(queue, job);
    } catch {
      // Already reported by the registry; the status is what the dispatcher acts on.
      return new Response(null, { status: 500 });
    }
    return new Response(null, { status: 204 });
  }

  private static parse(body: string): Delivery | null {
    try {
      const value = JSON.parse(body) as Partial<Delivery>;
      if (typeof value.queue !== "string" || typeof value.name !== "string") return null;
      return {
        queue: value.queue,
        id: typeof value.id === "string" ? value.id : "unknown",
        name: value.name,
        data: value.data ?? null,
        attempt: Number(value.attempt) || 1,
        maxAttempts: Number(value.maxAttempts) || 1,
      };
    } catch {
      return null;
    }
  }
}
