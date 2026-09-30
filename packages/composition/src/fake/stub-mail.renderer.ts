import { MailRenderer, type RenderedMail } from "../import.js";

// Canned, and deliberately echoing its inputs: a spec asserting on rendered copy is
// asserting on `content`, which has its own suite and its own catalog.
export class StubMailRenderer extends MailRenderer {
  public override render(template: string, locale: string): Promise<RenderedMail> {
    return Promise.resolve({
      subject: `${template}:${locale}`,
      text: `${template} text`,
      html: `<p>${template}</p>`,
    });
  }
}
