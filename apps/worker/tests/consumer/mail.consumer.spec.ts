import { SendMailUseCase } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import { RecordingEmailSender, StubMailRenderer, TestContainer } from "@loadbearing/composition";
import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import { MailConsumer } from "../../src/consumer/mail.consumer.js";

// `TestContainer` rather than an object literal, for the reason the maintenance spec
// gives: a port added to the container is a compile error there and was silence here.
function harness() {
  const email = new RecordingEmailSender();
  const ports = TestContainer.build({ email });

  const container = {
    ...ports,
    mail: { send: new SendMailUseCase(new StubMailRenderer(), email) },
  } as unknown as Container;

  return { container, email };
}

const job = (name: string, data: Record<string, unknown> = {}): Job =>
  ({ name, data }) as unknown as Job;

const send = (params: unknown = { url: "https://example.test/v" }) =>
  job("send", { template: "auth.verify", to: "a@example.test", locale: "en", params });

function consumerFor(container: Container): MailConsumer {
  // The Redis connection is only read by `start()`, which this spec never calls.
  return new MailConsumer(container, undefined as never, 1, 600);
}

describe("MailConsumer", () => {
  it("throws on a job name it does not know", async () => {
    const { container, email } = harness();

    // A publisher renamed on one side and not the other must be loud: succeeding quietly
    // is indistinguishable from working.
    await expect(consumerFor(container).handle(job("deliver"))).rejects.toThrow(
      "Unknown mail job: deliver",
    );

    expect(email.sent()).toEqual([]);
  });

  it("renders and sends a `send` job", async () => {
    const { container, email } = harness();

    await consumerFor(container).handle(send());

    expect(email.sent()).toHaveLength(1);
    expect(email.sent()[0]).toMatchObject({ to: "a@example.test" });
  });

  // BullMQ's retry is driven by rejection, so a consumer that caught here would turn a
  // provider outage into permanent, silent loss.
  it("lets a validation failure reject rather than swallowing it", async () => {
    const { container, email } = harness();

    await expect(consumerFor(container).handle(send({ url: "not-a-url" }))).rejects.toThrow();

    expect(email.sent()).toEqual([]);
  });
});
