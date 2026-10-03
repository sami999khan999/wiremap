import type { DomainEvent, WebhookKind } from "../import.js";

export interface RenderContext {
  readonly projectName: string;
  // Where a person reading the message lands: the project's page for the event.
  readonly link: string;
}

const TITLES: Readonly<Record<string, string>> = Object.freeze({
  "scan.succeeded": "Scan succeeded",
  "scan.failed": "Scan failed",
  "finding.created": "New finding",
  "webhook.test": "Test delivery",
});

// The body of one delivery: the event as it was published for a generic receiver, or a
// Slack message with Block Kit. Slack shows the text when the blocks cannot render.
export class WebhookRenderer {
  private constructor() {}

  public static body(kind: WebhookKind, event: DomainEvent, context: RenderContext): string {
    return JSON.stringify(
      kind === "slack" ? WebhookRenderer.slack(event, context) : WebhookRenderer.generic(event, context),
    );
  }

  private static generic(event: DomainEvent, context: RenderContext) {
    return {
      id: event.id,
      event: event.name,
      organizationId: event.organizationId,
      occurredAt: event.occurredAt,
      project: { name: context.projectName, url: context.link },
      payload: event.payload,
    };
  }

  private static slack(event: DomainEvent, context: RenderContext) {
    const title = `${TITLES[event.name] ?? event.name} · ${context.projectName}`;
    const detail = WebhookRenderer.detail(event);
    return {
      text: detail ? `${title}: ${detail}` : title,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${WebhookRenderer.escape(title)}*` } },
        ...(detail
          ? [{ type: "section", text: { type: "mrkdwn", text: WebhookRenderer.escape(detail) } }]
          : []),
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Open in wiremap" }, url: context.link },
          ],
        },
      ],
    };
  }

  private static detail(event: DomainEvent): string | null {
    const payload = event.payload as Readonly<Record<string, unknown>>;
    switch (event.name) {
      case "scan.succeeded": {
        const found = Number(payload.newFindings ?? 0);
        return found > 0 ? `${found} new findings` : "No new findings";
      }
      case "scan.failed":
        return typeof payload.error === "string" ? payload.error : null;
      case "finding.created":
        return `${payload.kind === "cycle" ? "Import cycle" : "Unguarded route"}: ${String(payload.key ?? "")}`;
      default:
        return null;
    }
  }

  // Slack's mrkdwn reads `<`, `>` and `&` as markup, so a path or an error is escaped.
  private static escape(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
}
