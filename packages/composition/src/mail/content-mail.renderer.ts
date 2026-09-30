import {
  type ContentSource,
  type Locale,
  MailRenderer,
  type MailTemplateKey,
  type MailTemplateParams,
  type RenderedMail,
  type Translator,
} from "../import.js";
import { MailLayout } from "./mail-layout.js";

// Where the `email` catalog and the mail layout meet, which is why it is in the wiring
// package: `application` owes no words and `content` owes no markup.
export class ContentMailRenderer extends MailRenderer {
  // `baseUrl`, because a link in a message has no page to resolve against. The
  // notification templates build `/settings/members`, which renders as nothing at all.
  public constructor(
    private readonly content: ContentSource,
    private readonly baseUrl: string,
  ) {
    super();
  }

  // Absolute already, or made absolute here. A caller that knows the origin still
  // passes one — this is the floor, not a second place to decide the link.
  private absolute(url: string): string {
    if (!url) return url;
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `${this.baseUrl}${url}`;
  }

  public override async render<K extends MailTemplateKey>(
    template: K,
    locale: Locale,
    params: MailTemplateParams<K>,
  ): Promise<RenderedMail> {
    // The recipient's locale, resolved per message. `Translator` is immutable, so this is
    // a lookup rather than a second rendering system.
    const t = await this.content.translator(locale, ["email"]);

    // Widened to the union before the switch: TypeScript narrows a union, not a type
    // parameter, so switching on `template` directly leaves the default unreachable-typed.
    const key: MailTemplateKey = template;

    switch (key) {
      case "auth.verify":
        return ContentMailRenderer.link(t, "verify", params as MailTemplateParams<"auth.verify">);
      case "auth.reset":
        return ContentMailRenderer.link(t, "reset", params as MailTemplateParams<"auth.reset">);
      case "auth.change":
        return ContentMailRenderer.link(t, "change", params as MailTemplateParams<"auth.change">);
      case "auth.otp":
        return ContentMailRenderer.otp(t, params as MailTemplateParams<"auth.otp">);
      case "member.invitation":
        return ContentMailRenderer.invitation(t, params as MailTemplateParams<"member.invitation">);
      case "notification.single": {
        const single = params as MailTemplateParams<"notification.single">;
        return ContentMailRenderer.notification(t, {
          ...single,
          url: this.absolute(single.url),
        });
      }
      case "notification.digest": {
        const digest = params as MailTemplateParams<"notification.digest">;
        return ContentMailRenderer.digest(t, { ...digest, url: this.absolute(digest.url) });
      }
      default:
        // Exhaustive: a key added to the manifest fails to compile here until it has a
        // template, which is the whole reason the manifest is closed.
        return ContentMailRenderer.unreachable(key);
    }
  }

  // The three that are one sentence and a link. They differ only in their key prefix, so
  // writing them out three times would be three places to forget the plain-text part.
  private static link(
    t: Translator,
    kind: "verify" | "reset" | "change",
    params: { readonly url: string },
  ): RenderedMail {
    const subject = t.t(`email.${kind}.subject`);

    return ContentMailRenderer.compose(subject, [t.t(`email.${kind}.body`)], {
      label: t.t(`email.${kind}.action`),
      url: params.url,
    });
  }

  // No action link, deliberately: a code rendered as a URL is a second factor made
  // clickable on the device the sign-in is not happening on.
  private static otp(t: Translator, params: { readonly code: string }): RenderedMail {
    return ContentMailRenderer.compose(t.t("email.otp.subject"), [
      t.t("email.otp.body", { code: params.code }),
      t.t("email.otp.expiry"),
    ]);
  }

  private static invitation(
    t: Translator,
    params: { readonly url: string; readonly inviter: string; readonly organization: string },
  ): RenderedMail {
    const copy = { inviter: params.inviter, organization: params.organization };

    return ContentMailRenderer.compose(
      t.t("email.invitation.subject", copy),
      [t.t("email.invitation.body", copy)],
      { label: t.t("email.invitation.action"), url: params.url },
    );
  }

  // Deliberately says *that* something happened rather than what. The recipient may not
  // be authorised for the thing by the time they read it, and mail cannot re-check.
  private static notification(
    t: Translator,
    params: { readonly name: string; readonly url: string },
  ): RenderedMail {
    return ContentMailRenderer.compose(
      t.t("email.notification.subject"),
      [t.t("email.notification.greeting", { name: params.name }), t.t("email.notification.body")],
      params.url ? { label: t.t("email.notification.action"), url: params.url } : undefined,
    );
  }

  // A count and a link, not a rendered list: N rows in mail is a second layout to keep
  // translated, and the inbox is one click away.
  private static digest(
    t: Translator,
    params: {
      readonly count: number;
      readonly name: string;
      readonly organization: string;
      readonly url: string;
    },
  ): RenderedMail {
    const subject =
      params.count === 0
        ? t.t("email.digest.subjectEmpty")
        : t.t("email.digest.subject", { count: params.count });

    return ContentMailRenderer.compose(
      subject,
      [
        t.t("email.digest.greeting", { name: params.name }),
        params.count === 0 ? t.t("email.digest.empty") : t.t("email.digest.intro"),
        t.t("email.digest.footer", { organization: params.organization }),
      ],
      params.url ? { label: t.t("email.digest.viewAll"), url: params.url } : undefined,
    );
  }

  // The subject doubles as the heading. Two keys per message that always said the same
  // thing would be two translations to keep in step for no reader's benefit.
  private static compose(
    subject: string,
    paragraphs: readonly string[],
    action?: { readonly label: string; readonly url: string },
  ): RenderedMail {
    const content = { heading: subject, paragraphs, ...(action ? { action } : {}) };

    return { subject, text: MailLayout.text(content), html: MailLayout.html(content) };
  }

  private static unreachable(template: never): never {
    throw new Error(`Unrendered mail template: ${String(template)}`);
  }
}
