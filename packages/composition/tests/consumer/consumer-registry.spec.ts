import { QueueName } from "@loadbearing/application";
import { describe, expect, it } from "vitest";
import { ConsumerRegistry, type QueueJob } from "../../src/consumer/index.js";
import { type Container, TestContainer } from "../../src/index.js";

interface Emitted {
  readonly code: string;
  readonly fields: unknown;
}

function harness() {
  const emitted: Emitted[] = [];
  const failures: unknown[] = [];
  const ports = TestContainer.build({});
  const container = {
    ...ports,
    logger: {
      emit: (code: string, fields: unknown) => emitted.push({ code, fields }),
      failure: (error: unknown) => failures.push(error),
    },
  } as unknown as Container;
  return { registry: new ConsumerRegistry(container), emitted, failures };
}

const job = (name: string, attempt = 1, maxAttempts = 3): QueueJob => ({
  id: "j1",
  name,
  data: { template: "auth.verify" },
  attempt,
  maxAttempts,
});

describe("ConsumerRegistry", () => {
  it("holds one consumer per queue the system publishes to", () => {
    const { registry } = harness();

    expect([...registry.queues()].sort()).toEqual(
      [
        QueueName.EMBEDDING,
        QueueName.MAIL,
        QueueName.MAINTENANCE,
        QueueName.NOTIFICATION,
        QueueName.EVENT,
      ].sort(),
    );
  });

  // A job for a queue nobody consumes must be loud: the host would otherwise ack it.
  it("throws for a queue it has no consumer for", async () => {
    const { registry } = harness();

    await expect(registry.run("nope", job("send"))).rejects.toThrow("No consumer for queue: nope");
  });

  // The host's retry is driven by rejection, so the registry reports and rethrows.
  it("reports a failure and rethrows it", async () => {
    const { registry, emitted, failures } = harness();

    await expect(registry.run(QueueName.MAIL, job("deliver"))).rejects.toThrow(
      "Unknown mail job: deliver",
    );

    expect(emitted.map((line) => line.code)).toEqual(["queue.job.failed"]);
    expect(failures).toHaveLength(1);
  });

  it("names a mail delivery as failed only on its last attempt", async () => {
    const { registry, emitted } = harness();

    await expect(registry.run(QueueName.MAIL, job("deliver", 3, 3))).rejects.toThrow();

    expect(emitted.map((line) => line.code)).toEqual(["queue.job.failed", "mail.delivery.failed"]);
  });
});
