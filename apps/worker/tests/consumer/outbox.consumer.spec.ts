import { EventSubscriber, QueueName, SubscriberRegistry } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import {
  FixedClock,
  InMemoryOutboxGateway,
  RecordingQueuePublisher,
  TestContainer,
} from "@loadbearing/composition";
import type { DomainEvent } from "@loadbearing/contracts";
import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import { OutboxConsumer } from "../../src/consumer/outbox.consumer.js";

const NOW = new Date("2026-08-15T00:00:00Z");
const ORG = "018f8c00-0000-7000-8000-000000000010";
const ACTOR = "018f8c00-0000-7000-8000-000000000011";
const ROLE = "018f8c00-0000-7000-8000-000000000012";

class Recording extends EventSubscriber {
  public readonly handled: DomainEvent[] = [];

  public constructor(
    public readonly name: string,
    public readonly events: DomainEvent["name"][],
    private readonly fail = false,
  ) {
    super();
  }

  public handle(event: DomainEvent): Promise<void> {
    if (this.fail) return Promise.reject(new Error("subscriber down"));
    this.handled.push(event);
    return Promise.resolve();
  }
}

const joined = (id: string): DomainEvent =>
  ({
    id,
    organizationId: ORG,
    name: "member.joined",
    actorId: ACTOR,
    occurredAt: NOW,
    payload: { userId: ACTOR, roleId: ROLE },
  }) as DomainEvent;

function harness(
  subscribers: readonly EventSubscriber[] = [new Recording("a", ["member.joined"])],
) {
  const outbox = new InMemoryOutboxGateway();
  const queue = new RecordingQueuePublisher();

  const container = {
    ...TestContainer.build({ outbox, queue }),
    clock: new FixedClock(NOW),
    subscribers: new SubscriberRegistry([...subscribers]),
    outbox,
    queue,
  } as unknown as Container;

  return { container, outbox, queue, subscribers };
}

const job = (name: string, data: unknown = {}): Job => ({ name, data }) as unknown as Job;

const consumerFor = (container: Container) => new OutboxConsumer(container, undefined as never, 1);

describe("OutboxConsumer", () => {
  it("throws on a job name it does not know", async () => {
    const { container } = harness();

    await expect(consumerFor(container).handle(job("publish"))).rejects.toThrow(
      "Unknown event job: publish",
    );
  });

  it("publishes one delivery job per subscriber that listens for the event", async () => {
    const { container, outbox, queue } = harness([
      new Recording("a", ["member.joined"]),
      new Recording("b", ["member.joined"]),
      new Recording("c", ["member.invited"]),
    ]);
    outbox.enqueue(joined("018f8c00-0000-7000-8000-000000000020"));

    await consumerFor(container).handle(job("drain"));

    const published = queue.publishedTo(QueueName.EVENT);
    expect(published).toHaveLength(2);
    expect(published.map((p) => p.options?.jobId)).toEqual([
      "a_018f8c00-0000-7000-8000-000000000020",
      "b_018f8c00-0000-7000-8000-000000000020",
    ]);
  });

  // The job id is the deduplication key, so a re-drained event produces the same ids and
  // BullMQ drops the second copy. Without it, a crash before the mark delivers twice.
  it("produces the same job ids when the same event is drained twice", async () => {
    const { container, outbox, queue } = harness();
    outbox.enqueue(joined("018f8c00-0000-7000-8000-000000000020"));

    await consumerFor(container).handle(job("drain"));
    outbox.enqueue(joined("018f8c00-0000-7000-8000-000000000020"));
    await consumerFor(container).handle(job("drain"));

    expect(queue.publishedTo(QueueName.EVENT)).toHaveLength(1);
  });

  // An event nobody listens for is still marked published. Leaving it pending would make
  // the outbox grow forever on a name whose subscriber was deleted.
  it("drains an event with no subscribers and publishes nothing", async () => {
    const { container, outbox, queue } = harness([new Recording("a", ["member.invited"])]);
    outbox.enqueue(joined("018f8c00-0000-7000-8000-000000000020"));

    await consumerFor(container).handle(job("drain"));

    expect(queue.publishedTo(QueueName.EVENT)).toEqual([]);
    expect(outbox.remaining()).toEqual([]);
  });

  it("parses the envelope and hands it to the named subscriber", async () => {
    const subscriber = new Recording("a", ["member.joined"]);
    const { container } = harness([subscriber]);

    await consumerFor(container).handle(
      job("deliver", { subscriber: "a", event: joined("018f8c00-0000-7000-8000-000000000020") }),
    );

    expect(subscriber.handled).toHaveLength(1);
    expect(subscriber.handled[0]?.name).toBe("member.joined");
  });

  // The job crossed Redis as JSON. Trusting it would let a malformed payload reach a
  // subscriber that has every right to assume its own schema.
  it("rejects a delivery whose event does not match the catalog", async () => {
    const { container } = harness();

    await expect(
      consumerFor(container).handle(
        job("deliver", { subscriber: "a", event: { ...joined("x"), name: "member.left" } }),
      ),
    ).rejects.toThrow();
  });

  // One event becomes one job per subscriber precisely so that a failure is that
  // delivery's retry and no other subscriber's.
  it("lets a failing subscriber reject without touching the others", async () => {
    const healthy = new Recording("ok", ["member.joined"]);
    const { container } = harness([healthy, new Recording("bad", ["member.joined"], true)]);
    const event = joined("018f8c00-0000-7000-8000-000000000020");

    await consumerFor(container).handle(job("deliver", { subscriber: "ok", event }));
    await expect(
      consumerFor(container).handle(job("deliver", { subscriber: "bad", event })),
    ).rejects.toThrow("subscriber down");

    expect(healthy.handled).toHaveLength(1);
  });
  // The drain's `priority: 1` is only ahead of jobs that have one. BullMQ's
  // `moveToActive` empties the plain wait list before it looks at the prioritized set.
  it("gives every delivery a priority, so the drain outranks it", async () => {
    const { container, outbox, queue } = harness();
    outbox.enqueue(joined("018f8c00-0000-7000-8000-000000000021"));

    await consumerFor(container).handle(job("drain"));

    const priorities = queue.publishedTo(QueueName.EVENT).map((sent) => sent.options?.priority);

    expect(priorities).toEqual([10]);
    expect(priorities.every((value) => typeof value === "number")).toBe(true);
  });
});
