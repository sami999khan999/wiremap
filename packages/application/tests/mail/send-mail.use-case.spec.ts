import { Identifiers } from "@loadbearing/contracts";
import { ValidationError } from "@loadbearing/errors";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { SendMailUseCase } from "../../src/mail/send-mail.use-case.js";
import type {
  EmailMessage,
  EmailReceipt,
  EmailSender,
  MailRenderer,
  RenderedMail,
} from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const SYSTEM = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const platform = () =>
  new Principal(
    ORG,
    SYSTEM,
    CapabilitySet.from({ wildcard: false, org: { grants: [], denies: [] }, goals: {} }),
  );

class RecordingRenderer implements MailRenderer {
  public readonly rendered: { template: string; locale: string; params: unknown }[] = [];

  public render(template: string, locale: string, params: unknown): Promise<RenderedMail> {
    this.rendered.push({ template, locale, params });
    return Promise.resolve({ subject: "s", text: "t", html: "<p>h</p>" });
  }
}

class RecordingSender implements EmailSender {
  public readonly sent: EmailMessage[] = [];

  public send(message: EmailMessage): Promise<EmailReceipt> {
    this.sent.push(message);
    return Promise.resolve({ messageId: null });
  }
}

const build = () => {
  const renderer = new RecordingRenderer();
  const email = new RecordingSender();
  return { renderer, email, useCase: new SendMailUseCase(renderer, email) };
};

describe("SendMailUseCase", () => {
  it("renders the template and sends both parts", async () => {
    const { renderer, email, useCase } = build();

    await useCase.execute(platform(), {
      template: "auth.verify",
      to: "a@example.test",
      locale: "en",
      params: { url: "https://example.test/verify?token=abc" },
    });

    expect(renderer.rendered).toHaveLength(1);
    // Both parts reach the transport: a text-only send is what the HTML layout replaced.
    expect(email.sent[0]).toMatchObject({ to: "a@example.test", text: "t", html: "<p>h</p>" });
  });

  // A job carries a string, so an unknown key is a runtime value rather than a compile
  // error — and it must fail where nothing has been sent yet.
  it("rejects a template the manifest does not know, before the transport", async () => {
    const { email, useCase } = build();

    const thrown = await useCase
      .execute(platform(), {
        template: "auth.nope",
        to: "a@example.test",
        locale: "en",
        params: {},
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(email.sent).toEqual([]);
  });

  it("rejects params that do not match the template, before the transport", async () => {
    const { renderer, email, useCase } = build();

    const thrown = await useCase
      .execute(platform(), {
        template: "member.invitation",
        to: "a@example.test",
        locale: "en",
        // `inviter` and `organization` missing, and `url` is not one.
        params: { url: "not-a-url" },
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ValidationError);
    // Nothing rendered either: a message that cannot be built will not build on a retry.
    expect(renderer.rendered).toEqual([]);
    expect(email.sent).toEqual([]);
  });

  it("hands the renderer the recipient's locale rather than a default", async () => {
    const { renderer, useCase } = build();

    await useCase.execute(platform(), {
      template: "auth.otp",
      to: "a@example.test",
      locale: "en",
      params: { code: "123456" },
    });

    expect(renderer.rendered[0]?.locale).toBe("en");
  });
});
