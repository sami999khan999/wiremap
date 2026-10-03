import type {
  OrganizationId,
  ProjectId,
  WebhookEventName,
  WebhookId,
} from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { DeliverWebhookUseCase } from "../../src/webhook/deliver-webhook.use-case.js";
import { ManageWebhooksUseCase } from "../../src/webhook/manage-webhooks.use-case.js";
import { WebhookRenderer } from "../../src/webhook/webhook.renderer.js";
import {
  type Delivery,
  type NewWebhook,
  type WebhookRecord,
  WebhookRepository,
} from "../../src/webhook/webhook.repository.js";
import type { WebhookRequest } from "../../src/webhook/webhook.sender.js";
import { WebhookSubscriber } from "../../src/webhook/webhook.subscriber.js";
import {
  ACTOR,
  CLOCK,
  DirectUnitOfWork,
  holding,
  ORG,
  RecordingActivity,
} from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;
const OTHER_PROJECT = "018f8c00-0000-7000-8000-0000000000c2" as ProjectId;

class MemoryWebhooks extends WebhookRepository {
  public readonly rows: WebhookRecord[] = [];
  public list() {
    return Promise.resolve(this.rows);
  }
  public findById(_org: OrganizationId, id: WebhookId) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  public save(_org: OrganizationId, webhook: NewWebhook) {
    this.rows.push({
      ...webhook,
      disabledAt: null,
      failureCount: 0,
      lastStatus: null,
      lastDeliveredAt: null,
      createdAt: new Date(),
    });
    return Promise.resolve();
  }
  private patch(id: WebhookId, change: Partial<WebhookRecord>) {
    const at = this.rows.findIndex((row) => row.id === id);
    this.rows[at] = { ...(this.rows[at] as WebhookRecord), ...change };
  }
  public setEvents(_org: OrganizationId, id: WebhookId, events: readonly WebhookEventName[]) {
    this.patch(id, { events });
    return Promise.resolve();
  }
  public setEnabled(_org: OrganizationId, id: WebhookId, enabled: boolean, at: Date) {
    this.patch(id, enabled ? { disabledAt: null, failureCount: 0 } : { disabledAt: at });
    return Promise.resolve();
  }
  public delete(_org: OrganizationId, id: WebhookId) {
    this.rows.splice(
      this.rows.findIndex((row) => row.id === id),
      1,
    );
    return Promise.resolve();
  }
  public removeForProject() {
    return Promise.resolve();
  }
  public recordDelivery(_org: OrganizationId, id: WebhookId, delivery: Delivery) {
    const row = this.rows.find((each) => each.id === id) as WebhookRecord;
    const failureCount = delivery.ok ? 0 : row.failureCount + 1;
    const disabled = !delivery.ok && failureCount >= delivery.disableAfter;
    this.patch(id, {
      failureCount,
      lastStatus: delivery.status,
      lastDeliveredAt: delivery.at,
      ...(disabled ? { disabledAt: delivery.at } : {}),
    });
    return Promise.resolve({ failureCount, disabled });
  }
}

const cipher = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

const setup = (answer: { ok: boolean; status: number | null } = { ok: true, status: 200 }) => {
  const webhooks = new MemoryWebhooks();
  const sent: WebhookRequest[] = [];
  const projects = { findById: () => Promise.resolve({ id: PROJECT, name: "Shop API" }) } as never;
  const deliver = new DeliverWebhookUseCase(
    webhooks,
    projects,
    {
      send: (request: WebhookRequest) => {
        sent.push(request);
        return Promise.resolve(answer);
      },
    },
    cipher,
    CLOCK,
    "https://wm.test",
  );
  const manage = new ManageWebhooksUseCase(
    new Authorizer(),
    webhooks,
    projects,
    cipher,
    deliver,
    new RecordingActivity(),
    new DirectUnitOfWork(),
    CLOCK,
  );
  return { webhooks, sent, deliver, manage };
};

const admin = holding("organization.webhook.manage");

const event = (projectId: ProjectId = PROJECT) => ({
  id: "0190a0b0-0000-7000-8000-00000000e001",
  name: "scan.failed" as const,
  organizationId: ORG,
  actorId: ACTOR,
  occurredAt: new Date("2026-10-03T00:00:00Z"),
  payload: {
    projectId,
    scanId: "0190a0b0-0000-7000-8000-00000000e002",
    trigger: "push",
    requestedBy: null,
    error: "tsconfig <broken>",
  },
});

describe("ManageWebhooksUseCase", () => {
  it("encrypts the URL and the secret, shows the secret once, and lists only a hint", async () => {
    const { manage, webhooks } = setup();
    const created = await manage.create(admin, {
      projectId: null,
      kind: "generic",
      url: "https://hooks.example.com/in/abcd1234",
      events: ["scan.failed", "scan.failed"],
    });

    expect(created.secret).toMatch(/^whsec_/);
    expect(created.webhook.target).toBe("hooks.example.com/…1234");
    expect(webhooks.rows[0]?.encryptedUrl).toBe("enc:https://hooks.example.com/in/abcd1234");
    expect(webhooks.rows[0]?.encryptedSecret).toBe(`enc:${created.secret}`);
    expect(webhooks.rows[0]?.events).toEqual(["scan.failed"]);
    expect(JSON.stringify(await manage.list(admin))).not.toContain("abcd1234");
  });

  it("gives a Slack webhook no secret, and refuses someone without the key", async () => {
    const { manage } = setup();
    const slack = await manage.create(admin, {
      projectId: PROJECT,
      kind: "slack",
      url: "https://hooks.slack.com/services/T/B/x",
      events: ["scan.succeeded"],
    });
    expect(slack.secret).toBeNull();
    await expect(manage.list(holding())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("WebhookSubscriber", () => {
  it("queues one job per enabled webhook that wants the event and the project", async () => {
    const { manage, webhooks } = setup();
    const make = (projectId: ProjectId | null, events: WebhookEventName[]) =>
      manage.create(admin, { projectId, kind: "generic", url: "https://h.test/x", events });
    const everyProject = await make(null, ["scan.failed"]);
    await make(OTHER_PROJECT, ["scan.failed"]);
    await make(PROJECT, ["scan.succeeded"]);
    const off = await make(PROJECT, ["scan.failed"]);
    await webhooks.setEnabled(ORG, off.webhook.id, false, new Date());

    const queued: { payload: { webhookId: string }; options?: { jobId?: string } }[] = [];
    const subscriber = new WebhookSubscriber(webhooks, {
      publishMany: (_queue: string, jobs: typeof queued) => {
        queued.push(...jobs);
        return Promise.resolve();
      },
    } as never);
    await subscriber.handle(event() as never);

    expect(queued.map((job) => job.payload.webhookId)).toEqual([everyProject.webhook.id]);
    expect(queued[0]?.options?.jobId).toBe(`${event().id}-${everyProject.webhook.id}`);
    expect(queued[0]?.options?.jobId).not.toContain(":");
  });
});

describe("DeliverWebhookUseCase", () => {
  it("signs with the webhook's secret and sends the event as published", async () => {
    const { manage, deliver, sent } = setup();
    const created = await manage.create(admin, {
      projectId: null,
      kind: "generic",
      url: "https://h.test/x",
      events: ["scan.failed"],
    });
    await deliver.execute({ organizationId: ORG, webhookId: created.webhook.id, event: event() });

    expect(sent[0]).toMatchObject({
      url: "https://h.test/x",
      secret: created.secret,
      event: "scan.failed",
    });
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({
      event: "scan.failed",
      project: { name: "Shop API", url: `https://wm.test/go/project/${PROJECT}?to=scans` },
    });
  });

  // A throw is the queue's retry; at the twentieth failure the webhook is off and the job ends.
  it("throws to retry a failure, and stops once twenty in a row switch it off", async () => {
    const { manage, deliver, webhooks } = setup({ ok: false, status: 503 });
    const created = await manage.create(admin, {
      projectId: null,
      kind: "generic",
      url: "https://h.test/x",
      events: ["scan.failed"],
    });
    const job = { organizationId: ORG, webhookId: created.webhook.id, event: event() };

    for (let attempt = 1; attempt < DeliverWebhookUseCase.DISABLE_AFTER; attempt++)
      await expect(deliver.execute(job)).rejects.toThrow("503");
    await expect(deliver.execute(job)).resolves.toBeUndefined();
    expect(webhooks.rows[0]?.disabledAt).toBeInstanceOf(Date);

    await manage.update(admin, { webhookId: created.webhook.id, enabled: true });
    expect(webhooks.rows[0]).toMatchObject({ disabledAt: null, failureCount: 0 });
  });
});

describe("WebhookRenderer", () => {
  it("writes Slack blocks with the markup escaped and a link back", () => {
    const body = JSON.parse(
      WebhookRenderer.body("slack", event(), {
        projectName: "Shop API",
        link: "https://wm.test/p",
      }),
    );
    expect(body.text).toBe("Scan failed · Shop API: tsconfig <broken>");
    expect(body.blocks[1].text.text).toBe("tsconfig &lt;broken&gt;");
    expect(body.blocks[2].elements[0].url).toBe("https://wm.test/p");
  });
});
