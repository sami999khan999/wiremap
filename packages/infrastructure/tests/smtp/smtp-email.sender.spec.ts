import { UnavailableError } from "@loadbearing/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmtpEmailSender } from "../../src/smtp/smtp-email.sender.js";
import { RecordingLogger } from "../support/recording.logger.js";

// `createTransport` is called in the constructor, so the double has to be in place
// before the sender is built — which is what this factory orders.
const sendMail = vi.fn();
const close = vi.fn();

vi.mock("../../src/import.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/import.js")>("../../src/import.js");
  return { ...actual, createTransport: () => ({ sendMail, close }) };
});

const sender = (logger?: RecordingLogger) =>
  new SmtpEmailSender({ url: "smtp://stub:1025", from: "no-reply@example.test" }, logger);

const message = { to: "b@example.test", subject: "hello", text: "body" };

afterEach(() => {
  sendMail.mockReset();
  close.mockReset();
});

describe("SmtpEmailSender", () => {
  it("sends from the configured address", async () => {
    sendMail.mockResolvedValue(undefined);

    await sender().send(message);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "no-reply@example.test" }),
    );
  });

  it("returns the transport's message id as the receipt", async () => {
    sendMail.mockResolvedValue({ messageId: "<abc@example.test>" });

    expect(await sender().send(message)).toEqual({ messageId: "<abc@example.test>" });
  });

  // A transport that answers with nothing has still accepted the message. Reading the id
  // off it without guarding turned that into a thrown `UnavailableError` and a retry.
  it("reports a null id rather than failing when the transport returns nothing", async () => {
    sendMail.mockResolvedValue(undefined);

    expect(await sender().send(message)).toEqual({ messageId: null });
  });

  it("normalises a transport failure to a retryable error", async () => {
    sendMail.mockRejectedValue(new Error("550 relay denied for b@example.test"));

    const thrown = await sender()
      .send(message)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UnavailableError);
    expect((thrown as UnavailableError).context).toMatchObject({ dependency: "smtp" });
  });

  // The regression guard: the transport's reason was discarded, so a caller that treats
  // a failed send as recoverable left nothing to diagnose from.
  it("records the transport's reason without the recipient", async () => {
    sendMail.mockRejectedValue(new Error("550 relay denied for b@example.test"));
    const logger = new RecordingLogger();

    await sender(logger)
      .send(message)
      .catch(() => undefined);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: "error",
      event: "email.send.failed",
      fields: { reason: "550 relay denied for b@example.test" },
    });
    expect(Object.keys(logger.entries[0]?.fields ?? {})).not.toContain("to");
  });

  it("throws without a logger", async () => {
    sendMail.mockRejectedValue(new Error("boom"));

    await expect(sender().send(message)).rejects.toThrow(UnavailableError);
  });

  // Nodemailer keeps sockets open between sends, so a process that exits without closing
  // them waits on the SMTP server to time each one out. `Container.dispose()` calls this.
  it("closes the transport", async () => {
    await sender().close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
