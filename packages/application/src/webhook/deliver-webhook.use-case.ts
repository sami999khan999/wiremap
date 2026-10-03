import type { Clock, OrganizationId, ProjectId, WebhookId } from "../import.js";
import type { SecretCipher } from "../port/index.js";
import type { ProjectRepository } from "../project/index.js";
import { type WebhookEvent, WebhookRenderer } from "./webhook.renderer.js";
import type { WebhookRepository } from "./webhook.repository.js";
import type { WebhookResponse, WebhookSender } from "./webhook.sender.js";

export interface WebhookJob {
  readonly organizationId: OrganizationId;
  readonly webhookId: WebhookId;
  readonly event: WebhookEvent;
}

// Sends one event to one webhook. A failure throws, so the queue retries it; twenty in a
// row switch the webhook off, which stops a dead endpoint costing a job every event.
export class DeliverWebhookUseCase {
  public static readonly DISABLE_AFTER = 20;

  public constructor(
    private readonly webhooks: WebhookRepository,
    private readonly projects: ProjectRepository,
    private readonly sender: WebhookSender,
    private readonly cipher: SecretCipher,
    private readonly clock: Clock,
    private readonly baseUrl: string,
  ) {}

  public async execute(job: WebhookJob): Promise<void> {
    const webhook = await this.webhooks.findById(job.organizationId, job.webhookId);
    // Removed or switched off since the job was queued: nothing to send, nothing to retry.
    if (!webhook || webhook.disabledAt) return;

    const response = await this.send(webhook.id, job.organizationId, job.event, job.event.id);
    const recorded = await this.webhooks.recordDelivery(job.organizationId, webhook.id, {
      ok: response.ok,
      status: response.status,
      at: this.clock.now(),
      disableAfter: DeliverWebhookUseCase.DISABLE_AFTER,
    });
    if (!response.ok && !recorded.disabled) {
      throw new Error(`Webhook delivery failed with ${response.status ?? "no response"}`);
    }
  }

  // Shared with the "Send test" button, which wants the answer rather than a retry.
  public async send(
    webhookId: WebhookId,
    organizationId: OrganizationId,
    event: WebhookEvent,
    deliveryId: string,
  ): Promise<WebhookResponse> {
    const webhook = await this.webhooks.findById(organizationId, webhookId);
    if (!webhook) return { ok: false, status: null };
    const projectId = event.payload.projectId as ProjectId | undefined;
    const project = projectId ? await this.projects.findById(organizationId, projectId) : null;
    const to = event.name.startsWith("finding.") ? "insights" : "scans";
    return this.sender.send({
      url: this.cipher.decrypt(webhook.encryptedUrl),
      body: WebhookRenderer.body(webhook.kind, event, {
        projectName: project?.name ?? "wiremap",
        link: projectId
          ? `${this.baseUrl}/go/project/${projectId}?to=${to}`
          : `${this.baseUrl}/settings/webhooks`,
      }),
      secret: webhook.encryptedSecret ? this.cipher.decrypt(webhook.encryptedSecret) : null,
      event: event.name,
      deliveryId,
    });
  }
}
