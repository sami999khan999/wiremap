import {
  createTransport,
  type EmailMessage,
  type EmailReceipt,
  EmailSender,
  type Logger,
  type Transporter,
  UnavailableError,
} from "../import.js";

export interface SmtpConfig {
  // A URL rather than five fields, so one environment variable works against Mailpit
  // locally and a managed sender in production.
  readonly url: string;
  // Not optional and not defaulted: an address the domain does not authorise bounces or
  // lands in spam, silently, on the first real deploy.
  readonly from: string;
  // Open connections the pool may hold. Five is what most providers allow one client.
  readonly maxConnections?: number;
}

// A hung server is a hung job: without these nodemailer waits minutes, holding the job's
// lock, before the retry that would have succeeded elsewhere can run.
const CONNECTION_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

// SMTP, not a provider's HTTP API: every managed sender speaks it, so swapping vendors is
// a URL rather than a new class.
export class SmtpEmailSender extends EmailSender {
  // Built once and pooled: a handshake and TLS per message was most of each send's time.
  // The pool connects on the first send, so a process that never mails opens no socket.
  private readonly transport: Transporter;

  public constructor(
    private readonly config: SmtpConfig,
    private readonly logger?: Logger,
  ) {
    super();
    this.transport = createTransport({
      url: config.url,
      pool: true,
      maxConnections: config.maxConnections ?? 5,
      // Recycled after this many, so a long-lived connection a provider has quietly
      // degraded is replaced rather than kept forever.
      maxMessages: 100,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: CONNECTION_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }

  public override async send(message: EmailMessage): Promise<EmailReceipt> {
    try {
      const info = (await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      })) as { messageId?: string } | undefined;

      // Every hop optional, because nodemailer types the result `any`: a transport that
      // resolves with no id has still sent the message, and must not read as a failure.
      return { messageId: info?.messageId ?? null };
    } catch (error: unknown) {
      // The transport's reason, which the error below cannot carry: a caller that treats
      // a failed send as recoverable would otherwise leave nothing to diagnose from.
      this.logger?.emit("email.send.failed", { reason: SmtpEmailSender.reason(error) });

      // UNAVAILABLE, not INTERNAL: the catalog marks it retryable, which is what lets a
      // queued send be retried rather than dead-lettered.
      throw new UnavailableError("smtp");
    }
  }

  // Nodemailer keeps sockets open between sends, and a process that exits without closing
  // them waits on the SMTP server to time each one out. Not `async`: `close()` is sync.
  public close(): Promise<void> {
    this.transport.close();
    return Promise.resolve();
  }

  // Truncated, because a rejected recipient list comes back as the whole message.
  private static reason(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 300);
  }
}
