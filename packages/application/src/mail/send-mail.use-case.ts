import { type Locale, MailTemplates, type SchemaIssue, ValidationError } from "../import.js";
import type { EmailReceipt, EmailSender, MailRenderer } from "../port/index.js";
import type { Principal } from "../primitive/index.js";

// The job's payload as it comes back off the queue: a template key that is still a
// string, and params that are still unknown. Narrowing both is this use-case's job.
export interface SendMailInput {
  readonly template: string;
  readonly to: string;
  readonly locale: Locale;
  readonly params: unknown;
}

// Validate, render, send. No repository, no status column and no idempotency of its own:
// the job id carries that, and a throw is the queue's retry signal.
export class SendMailUseCase {
  public constructor(
    private readonly renderer: MailRenderer,
    private readonly email: EmailSender,
  ) {}

  // `actor` asserts nothing and the receipt is the delivery record, because there is no
  // delivery table. Both are argued in docs/reference/ports.md.
  public execute(actor: Principal, input: SendMailInput): Promise<EmailReceipt> {
    void actor;
    return this.send(input);
  }

  private async send(input: SendMailInput): Promise<EmailReceipt> {
    // Both failures happen before the transport is touched, because a message that
    // cannot be rendered will not render on the retry either.
    if (!MailTemplates.isKnown(input.template)) {
      throw new ValidationError([{ field: "template", rule: "unknown" }]);
    }

    const parsed = MailTemplates.schema(input.template).safeParse(input.params);
    if (!parsed.success) throw ValidationError.fromIssues(SendMailUseCase.issues(parsed.error));

    const rendered = await this.renderer.render(input.template, input.locale, parsed.data);

    return this.email.send({
      to: input.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  // Zod paths may hold a symbol and `SchemaIssue` may not, because `errors` declares that
  // shape structurally to stay dependency-free. A symbol segment names no form field.
  private static issues(error: { issues: readonly ZodIssueLike[] }): readonly SchemaIssue[] {
    return error.issues.map((issue) => ({
      ...issue,
      path: issue.path.filter((part): part is string | number => typeof part !== "symbol"),
    }));
  }
}

interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
}
