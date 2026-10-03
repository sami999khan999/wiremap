import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export const WEBHOOK_KINDS = ["generic", "slack"] as const;
// The events a webhook may subscribe to. Each is a domain event the outbox already carries.
export const WEBHOOK_EVENTS = ["scan.succeeded", "scan.failed", "finding.created"] as const;

const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);

// https only: the request carries a signature over an event, and a Slack URL is itself a
// credential. Private and loopback hosts are refused again when the request is sent.
const url = z.url({ protocol: /^https$/ }).max(2_000);

export class WebhookContract {
  private constructor() {}

  public static readonly entity = z.object({
    id: Identifiers.webhookId,
    // Null: every project in the organization.
    projectId: Identifiers.projectId.nullable(),
    kind: z.enum(WEBHOOK_KINDS),
    // Host and the URL's last four characters. The URL itself is never read back.
    target: z.string(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).readonly(),
    disabledAt: z.date().nullable(),
    failureCount: z.number().int().nonnegative(),
    lastStatus: z.number().int().nullable(),
    lastDeliveredAt: z.date().nullable(),
    createdAt: z.date(),
  });

  public static readonly create = z.object({
    projectId: Identifiers.projectId.nullable(),
    kind: z.enum(WEBHOOK_KINDS),
    url,
    events,
  });

  // A generic webhook's signing secret, shown once. A Slack webhook has none: its URL is
  // the secret, and Slack verifies nothing.
  public static readonly created = z.object({
    webhook: WebhookContract.entity,
    secret: z.string().nullable(),
  });

  public static readonly update = z.object({
    webhookId: Identifiers.webhookId,
    events: events.optional(),
    // `true` re-enables one switched off after repeated failures, and clears the count.
    enabled: z.boolean().optional(),
  });

  public static readonly ref = z.object({ webhookId: Identifiers.webhookId });

  public static readonly tested = z.object({
    ok: z.boolean(),
    status: z.number().int().nullable(),
  });
}

export type WebhookKind = (typeof WEBHOOK_KINDS)[number];
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
export type WebhookDto = z.infer<typeof WebhookContract.entity>;
export type CreateWebhookInput = z.infer<typeof WebhookContract.create>;
export type CreatedWebhookDto = z.infer<typeof WebhookContract.created>;
export type UpdateWebhookInput = z.infer<typeof WebhookContract.update>;
