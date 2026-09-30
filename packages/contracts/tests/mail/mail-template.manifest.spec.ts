import { describe, expect, it } from "vitest";
import { MailTemplates } from "../../src/mail/index.js";

describe("MailTemplates", () => {
  it("knows every key it lists and nothing else", () => {
    for (const key of MailTemplates.keys()) {
      expect(MailTemplates.isKnown(key)).toBe(true);
    }

    expect(MailTemplates.isKnown("auth.nope")).toBe(false);
  });

  // A bare index would resolve this up the prototype chain to a function and hand the
  // renderer something with no `safeParse` on it.
  it("does not treat an inherited property as a template", () => {
    expect(MailTemplates.isKnown("toString")).toBe(false);
    expect(MailTemplates.isKnown("constructor")).toBe(false);
  });

  it("rejects params that are not an object at all", () => {
    expect(MailTemplates.schema("auth.otp").safeParse("123456").success).toBe(false);
  });

  // The keys are the wire vocabulary between a publisher and the worker, so a rename is
  // a breaking change to jobs already on the queue.
  it("carries every template the renderer knows", () => {
    expect([...MailTemplates.keys()].sort()).toEqual([
      "auth.change",
      "auth.otp",
      "auth.reset",
      "auth.verify",
      "member.invitation",
      "notification.digest",
      "notification.single",
    ]);
  });
});
