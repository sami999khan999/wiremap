import { QueueName } from "@loadbearing/application";
import { describe, expect, it } from "vitest";
import { RecordingQueuePublisher } from "../../src/fake/index.js";
import { QueuedAuthMailer } from "../../src/mail/queued-auth.mailer.js";
import { QueuedInvitationMailer } from "../../src/mail/queued-invitation.mailer.js";
import { QueuedMailPublisher } from "../../src/mail/queued-mail.publisher.js";

const ORG = "018f8c00-0000-7000-8000-000000000010" as never;
const USER = "018f8c00-0000-7000-8000-000000000011" as never;

const build = () => {
  const queue = new RecordingQueuePublisher();
  return { queue, mail: new QueuedMailPublisher(queue) };
};

const recipient = { email: "a@example.test", userId: USER, locale: "bn" as const };

describe("QueuedMailPublisher", () => {
  // A digest page as one batch, each job keeping the options a single send would get.
  it("publishes a batch with the options each single send would have", async () => {
    const { queue, mail } = build();
    const batches: number[] = [];
    const publishMany = queue.publishMany.bind(queue);
    queue.publishMany = (name, jobs) => {
      batches.push(jobs.length);
      return publishMany(name, jobs);
    };

    await mail.publishMany(
      ["a", "b"].map((who) => ({
        template: "notification.single" as const,
        to: `${who}@example.test`,
        locale: "en" as const,
        params: { kind: "message.direct", name: who, url: "" },
        organizationId: ORG,
        userId: USER,
        dedupeKey: `n_${who}`,
      })),
    );

    expect(batches).toEqual([2]);
    const jobs = queue.publishedTo(QueueName.MAIL);
    expect(jobs.map((job) => job.options?.onceWithin?.id)).toEqual(["n_a", "n_b"]);
    expect(jobs.every((job) => job.options?.name === "send")).toBe(true);
  });

  it("publishes one `send` job on the mail queue", async () => {
    const { queue, mail } = build();

    await mail.publish({
      template: "auth.verify",
      to: "a@example.test",
      locale: "en",
      params: { url: "https://example.test/v" },
      organizationId: null,
      userId: null,
    });

    const job = queue.publishedTo(QueueName.MAIL)[0];
    // The name is what `MailConsumer` switches on; without it every job on this queue
    // would arrive named after the queue itself.
    expect(job?.options?.name).toBe("send");
  });

  // More attempts and the front of the queue, because somebody is sitting in front of a
  // screen waiting for a verification link and nobody is waiting on a digest.
  it("gives high priority more attempts and a lower priority number", async () => {
    const { queue, mail } = build();
    const base = {
      to: "a@example.test",
      locale: "en" as const,
      organizationId: null,
      userId: null,
      params: { url: "https://example.test/v" },
    };

    await mail.publish({ ...base, template: "auth.verify", priority: "high" });
    await mail.publish({ ...base, template: "auth.reset" });

    const [high, normal] = queue.publishedTo(QueueName.MAIL);
    expect(high?.options?.attempts).toBe(10);
    expect(normal?.options?.attempts).toBe(8);
    expect(high?.options?.priority).toBeLessThan(normal?.options?.priority ?? 0);
  });

  // A day, and not a job id: the job id held only while the completed job was kept, so a
  // digest past a thousand recipients re-sent the earlier pages on a retry (`RV.5`).
  it("turns a dedupeKey into a day-long onceWithin and omits it otherwise", async () => {
    const { queue, mail } = build();
    const base = {
      to: "a@example.test",
      locale: "en" as const,
      organizationId: null,
      userId: null,
      params: { url: "https://example.test/v" },
    };

    await mail.publish({ ...base, template: "auth.verify", dedupeKey: "verify-1" });
    await mail.publish({ ...base, template: "auth.reset" });

    const [withKey, without] = queue.publishedTo(QueueName.MAIL);
    expect(withKey?.options?.onceWithin).toEqual({ id: "verify-1", seconds: 86_400 });
    expect(withKey?.options).not.toHaveProperty("jobId");
    // Absent rather than undefined-valued: the adapter spreads it only when it is there.
    expect(without?.options).not.toHaveProperty("onceWithin");
  });

  it("publishes a repeated dedupeKey once", async () => {
    const { queue, mail } = build();
    const request = {
      template: "auth.verify" as const,
      to: "a@example.test",
      locale: "en" as const,
      organizationId: null,
      userId: null,
      params: { url: "https://example.test/v" },
      dedupeKey: "verify-1",
    };

    await mail.publish(request);
    await mail.publish(request);

    expect(queue.publishedTo(QueueName.MAIL)).toHaveLength(1);
  });
});

describe("QueuedAuthMailer", () => {
  it("sends every message at high priority with the recipient's locale", async () => {
    const { queue, mail } = build();
    const mailer = new QueuedAuthMailer(mail);

    await mailer.sendVerification(recipient, "https://example.test/v");
    await mailer.sendPasswordReset(recipient, "https://example.test/r");
    await mailer.sendEmailChangeConfirmation(recipient, "https://example.test/c");
    await mailer.sendTwoFactorOtp(recipient, "123456");

    const jobs = queue.publishedTo(QueueName.MAIL);
    expect(jobs).toHaveLength(4);
    for (const job of jobs) {
      expect(job.options?.attempts).toBe(10);
      expect(job.payload).toMatchObject({ locale: "bn", organizationId: null });
    }
  });

  // Better Auth issues a fresh single-use token per send, so suppressing the second one
  // would mail a link the server has already replaced.
  it("sets no dedupeKey, because each send carries a new token", async () => {
    const { queue, mail } = build();

    await new QueuedAuthMailer(mail).sendVerification(recipient, "https://example.test/v");

    expect(queue.publishedTo(QueueName.MAIL)[0]?.options).not.toHaveProperty("jobId");
  });
});

describe("QueuedInvitationMailer", () => {
  it("builds the link from the configured origin and the declared route", async () => {
    const { queue, mail } = build();
    const mailer = new QueuedInvitationMailer(mail, "https://app.example.test");

    await mailer.send({
      to: "b@example.test",
      organizationId: ORG,
      organizationName: "Acme",
      inviterName: "Ada",
      token: "tok",
    });

    const payload = queue.publishedTo(QueueName.MAIL)[0]?.payload as {
      params: { url: string };
      organizationId: string | null;
    };

    expect(payload.params.url).toBe("https://app.example.test/invitation/tok");
    // The one mail that belongs to a tenant, and the field exists to say so.
    expect(payload.organizationId).toBe(ORG);
  });
});
