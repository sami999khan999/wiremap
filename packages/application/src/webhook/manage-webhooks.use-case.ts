import {
  type Clock,
  NotFoundError,
  type ProjectId,
  Token,
  Uuid,
  type WebhookEventName,
  type WebhookId,
  type WebhookKind,
} from "../import.js";
import type { ActivityLogger, SecretCipher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ProjectRepository } from "../project/index.js";
import type { DeliverWebhookUseCase } from "./deliver-webhook.use-case.js";
import type { WebhookRecord, WebhookRepository } from "./webhook.repository.js";

export interface WebhookView {
  readonly id: WebhookId;
  readonly projectId: ProjectId | null;
  readonly kind: WebhookKind;
  readonly target: string;
  readonly events: readonly WebhookEventName[];
  readonly disabledAt: Date | null;
  readonly failureCount: number;
  readonly lastStatus: number | null;
  readonly lastDeliveredAt: Date | null;
  readonly createdAt: Date;
}

const PERMISSION = "organization.webhook.manage";

// The organization's outgoing webhooks. The URL and the signing secret are encrypted on
// the way in and never read back: the list shows a hint, and the secret is shown once.
export class ManageWebhooksUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly webhooks: WebhookRepository,
    private readonly projects: ProjectRepository,
    private readonly cipher: SecretCipher,
    private readonly deliver: DeliverWebhookUseCase,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async list(actor: Principal): Promise<readonly WebhookView[]> {
    this.authorizer.assert(actor, PERMISSION);
    return (await this.webhooks.list(actor.organizationId)).map((webhook) =>
      ManageWebhooksUseCase.view(webhook),
    );
  }

  public async create(
    actor: Principal,
    input: {
      readonly projectId: ProjectId | null;
      readonly kind: WebhookKind;
      readonly url: string;
      readonly events: readonly WebhookEventName[];
    },
  ): Promise<{ readonly webhook: WebhookView; readonly secret: string | null }> {
    this.authorizer.assert(actor, PERMISSION);
    if (input.projectId && !(await this.projects.findById(actor.organizationId, input.projectId)))
      throw new NotFoundError("project", input.projectId);

    const id = Uuid.v7() as WebhookId;
    const secret = input.kind === "generic" ? `whsec_${Token.random()}` : null;
    await this.unitOfWork.run(async () => {
      await this.webhooks.save(actor.organizationId, {
        id,
        projectId: input.projectId,
        kind: input.kind,
        encryptedUrl: this.cipher.encrypt(input.url),
        urlHint: ManageWebhooksUseCase.hint(input.url),
        encryptedSecret: secret ? this.cipher.encrypt(secret) : null,
        events: [...new Set(input.events)],
      });
      await this.activity.record(actor, "webhook.created", {
        webhookId: id,
        kind: input.kind,
        projectId: input.projectId,
        events: input.events,
      });
    });
    return { webhook: await this.one(actor, id), secret };
  }

  public async update(
    actor: Principal,
    input: {
      readonly webhookId: WebhookId;
      readonly events?: readonly WebhookEventName[] | undefined;
      readonly enabled?: boolean | undefined;
    },
  ): Promise<WebhookView> {
    this.authorizer.assert(actor, PERMISSION);
    const webhook = await this.one(actor, input.webhookId);
    await this.unitOfWork.run(async () => {
      if (input.events)
        await this.webhooks.setEvents(actor.organizationId, webhook.id, [...new Set(input.events)]);
      if (input.enabled !== undefined)
        await this.webhooks.setEnabled(
          actor.organizationId,
          webhook.id,
          input.enabled,
          this.clock.now(),
        );
      await this.activity.record(actor, "webhook.updated", {
        webhookId: webhook.id,
        events: input.events ?? null,
        enabled: input.enabled ?? null,
      });
    });
    return this.one(actor, webhook.id);
  }

  public async remove(actor: Principal, input: { readonly webhookId: WebhookId }): Promise<void> {
    this.authorizer.assert(actor, PERMISSION);
    const webhook = await this.one(actor, input.webhookId);
    await this.unitOfWork.run(async () => {
      await this.webhooks.delete(actor.organizationId, webhook.id);
      await this.activity.record(actor, "webhook.removed", { webhookId: webhook.id });
    });
  }

  // Sent now and answered now, so the page can say whether the receiver took it. It is not
  // recorded against the failure count: a test is the person checking, not the system.
  public async test(
    actor: Principal,
    input: { readonly webhookId: WebhookId },
  ): Promise<{ readonly ok: boolean; readonly status: number | null }> {
    this.authorizer.assert(actor, PERMISSION);
    const webhook = await this.one(actor, input.webhookId);
    const id = Uuid.v7();
    return this.deliver.send(
      webhook.id,
      actor.organizationId,
      {
        id,
        name: "webhook.test",
        organizationId: actor.organizationId,
        occurredAt: this.clock.now(),
        payload: webhook.projectId ? { projectId: webhook.projectId } : {},
      },
      id,
    );
  }

  private async one(actor: Principal, id: WebhookId): Promise<WebhookView> {
    const webhook = await this.webhooks.findById(actor.organizationId, id);
    if (!webhook) throw new NotFoundError("webhook", id);
    return ManageWebhooksUseCase.view(webhook);
  }

  // `hooks.slack.com/…a1b2`: enough to tell two apart, nothing a reader could replay.
  public static hint(url: string): string {
    // No `URL` here: the domain package carries no DOM or node types. The contract has
    // already checked it is an https URL, so the host is what sits between `//` and `/`.
    const host = /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? "";
    return `${host}/…${url.slice(-4)}`;
  }

  private static view(webhook: WebhookRecord): WebhookView {
    return {
      id: webhook.id,
      projectId: webhook.projectId,
      kind: webhook.kind,
      target: webhook.urlHint,
      events: webhook.events,
      disabledAt: webhook.disabledAt,
      failureCount: webhook.failureCount,
      lastStatus: webhook.lastStatus,
      lastDeliveredAt: webhook.lastDeliveredAt,
      createdAt: webhook.createdAt,
    };
  }
}
