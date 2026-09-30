import type { Locale, MailTemplateKey, MailTemplateParams } from "../import.js";

export interface RenderedMail {
  readonly subject: string;
  // Both parts, always. Text is what every client can render and what keeps a message out
  // of a spam folder; HTML is what makes the action look like a button.
  readonly text: string;
  readonly html: string;
}

// Copy and layout, and nothing about transport: `application` may know neither the words
// nor the routes, and the catalog holding them is server-only.
export abstract class MailRenderer {
  public abstract render<K extends MailTemplateKey>(
    template: K,
    locale: Locale,
    params: MailTemplateParams<K>,
  ): Promise<RenderedMail>;
}
