export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  // Text required, HTML not: every client renders text, and a text part is what keeps a
  // message out of a spam folder.
  readonly text: string;
  readonly html?: string;
}

export interface EmailReceipt {
  // Null when the transport returns none. This system keeps no delivery table, so the
  // id exists to be logged and later correlated against a provider's own record.
  readonly messageId: string | null;
}

// No provider, credentials or from-address — those are adapter configuration. One
// method, because a campaign or a suppression list is a different port.
export abstract class EmailSender {
  // Accepted by the transport, which is not delivery and never can be: only a provider
  // webhook can answer that. See docs/reference/ports.md.
  public abstract send(message: EmailMessage): Promise<EmailReceipt>;
}
