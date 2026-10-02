import { DomainEventPublisher, type Principal, QueueName } from "@loadbearing/application";
import { describe, expect, it, vi } from "vitest";
import { RecordingQueuePublisher } from "../../src/fake/index.js";
import { OutboxDrainPublisher } from "../../src/outbox/index.js";

class CountingPublisher extends DomainEventPublisher {
  public published = 0;
  public async publish(): Promise<void> {
    this.published += 1;
  }
}

const actor = {} as Principal;
const event = { name: "member.joined", payload: {} } as never;
const logger = () => ({ failure: vi.fn() }) as never;

describe("OutboxDrainPublisher", () => {
  it("writes the event, then asks for a delayed, deduplicated drain", async () => {
    const events = new CountingPublisher();
    const queue = new RecordingQueuePublisher();

    await new OutboxDrainPublisher(events, queue, logger(), () => 12_000).publish(actor, event);

    expect(events.published).toBe(1);
    const [job] = queue.publishedTo(QueueName.EVENT);
    expect(job?.options).toMatchObject({
      name: "drain",
      delayMs: 5_000,
      onceWithin: { id: "drain_2", seconds: 5 },
    });
  });

  // A queue outage must cost latency, never the caller's transaction.
  it("swallows and reports a failed drain request", async () => {
    const events = new CountingPublisher();
    const queue = new RecordingQueuePublisher();
    vi.spyOn(queue, "publish").mockRejectedValue(new Error("down"));
    const log = logger();

    await expect(
      new OutboxDrainPublisher(events, queue, log, () => 0).publish(actor, event),
    ).resolves.toBeUndefined();

    expect(events.published).toBe(1);
    expect(
      (log as unknown as { failure: ReturnType<typeof vi.fn> }).failure,
    ).toHaveBeenCalledOnce();
  });
});
