import { type EmailMessage, type EmailReceipt, EmailSender } from "../import.js";

// Records instead of sending: "a verification message went to that address, once, with
// the callback URL in it" is the assertion, and it needs no SMTP server.
export class RecordingEmailSender extends EmailSender {
  private readonly messages: EmailMessage[] = [];

  public override send(message: EmailMessage): Promise<EmailReceipt> {
    this.messages.push(message);
    // A stable, derivable id rather than null: a spec asserting that the receipt reached
    // a log line needs one, and the position in `messages` is the only id here.
    return Promise.resolve({ messageId: `recorded-${this.messages.length}` });
  }

  public sent(): readonly EmailMessage[] {
    return this.messages;
  }

  public sentTo(address: string): readonly EmailMessage[] {
    return this.messages.filter((message) => message.to === address);
  }
}
