import type {
  OrganizationId,
  ProjectId,
  WebhookEventName,
  WebhookId,
  WebhookKind,
} from "../import.js";

export interface WebhookRecord {
  readonly id: WebhookId;
  readonly projectId: ProjectId | null;
  readonly kind: WebhookKind;
  // Both encrypted with `SecretCipher`: a Slack URL is a credential on its own.
  readonly encryptedUrl: string;
  readonly urlHint: string;
  readonly encryptedSecret: string | null;
  readonly events: readonly WebhookEventName[];
  readonly disabledAt: Date | null;
  readonly failureCount: number;
  readonly lastStatus: number | null;
  readonly lastDeliveredAt: Date | null;
  readonly createdAt: Date;
}

export type NewWebhook = Omit<
  WebhookRecord,
  "disabledAt" | "failureCount" | "lastStatus" | "lastDeliveredAt" | "createdAt"
>;

export interface Delivery {
  readonly ok: boolean;
  readonly status: number | null;
  readonly at: Date;
  // Failures in a row that switch the webhook off.
  readonly disableAfter: number;
}

export abstract class WebhookRepository {
  public abstract list(organizationId: OrganizationId): Promise<readonly WebhookRecord[]>;

  public abstract findById(
    organizationId: OrganizationId,
    id: WebhookId,
  ): Promise<WebhookRecord | null>;

  public abstract save(organizationId: OrganizationId, webhook: NewWebhook): Promise<void>;

  public abstract setEvents(
    organizationId: OrganizationId,
    id: WebhookId,
    events: readonly WebhookEventName[],
  ): Promise<void>;

  // Enabling clears the failure count too: a webhook switched back on starts afresh.
  public abstract setEnabled(
    organizationId: OrganizationId,
    id: WebhookId,
    enabled: boolean,
    at: Date,
  ): Promise<void>;

  public abstract delete(organizationId: OrganizationId, id: WebhookId): Promise<void>;

  // One statement, so two deliveries finishing together cannot both read the old count.
  public abstract recordDelivery(
    organizationId: OrganizationId,
    id: WebhookId,
    delivery: Delivery,
  ): Promise<{ readonly failureCount: number; readonly disabled: boolean }>;
}
