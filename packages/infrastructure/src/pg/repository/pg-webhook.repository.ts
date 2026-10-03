import {
  and,
  asc,
  type Delivery,
  eq,
  type NewWebhook,
  type OrganizationId,
  type Placement,
  sql,
  type WebhookEventName,
  type WebhookId,
  type WebhookRecord,
  type WebhookRepository,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { webhooks } from "../schema/index.js";

type WebhookRow = typeof webhooks.$inferSelect;

export class PgWebhookRepository extends BaseRepository implements WebhookRepository {
  protected override readonly placement: Placement = "routed";

  public async list(organizationId: OrganizationId): Promise<readonly WebhookRecord[]> {
    const rows = await this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.organizationId, organizationId))
      .orderBy(asc(webhooks.createdAt));
    return rows.map((row) => PgWebhookRepository.record(row));
  }

  public async findById(
    organizationId: OrganizationId,
    id: WebhookId,
  ): Promise<WebhookRecord | null> {
    const [row] = await this.db
      .select()
      .from(webhooks)
      .where(this.one(organizationId, id))
      .limit(1);
    return row ? PgWebhookRepository.record(row) : null;
  }

  public async save(organizationId: OrganizationId, webhook: NewWebhook): Promise<void> {
    await this.db.insert(webhooks).values({
      id: webhook.id,
      organizationId,
      projectId: webhook.projectId,
      kind: webhook.kind,
      encryptedUrl: webhook.encryptedUrl,
      urlHint: webhook.urlHint,
      encryptedSecret: webhook.encryptedSecret,
      events: [...webhook.events],
    });
  }

  public async setEvents(
    organizationId: OrganizationId,
    id: WebhookId,
    events: readonly WebhookEventName[],
  ): Promise<void> {
    await this.db
      .update(webhooks)
      .set({ events: [...events] })
      .where(this.one(organizationId, id));
  }

  public async setEnabled(
    organizationId: OrganizationId,
    id: WebhookId,
    enabled: boolean,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(webhooks)
      .set(enabled ? { disabledAt: null, failureCount: 0 } : { disabledAt: at })
      .where(this.one(organizationId, id));
  }

  public async delete(organizationId: OrganizationId, id: WebhookId): Promise<void> {
    await this.db.delete(webhooks).where(this.one(organizationId, id));
  }

  public async recordDelivery(
    organizationId: OrganizationId,
    id: WebhookId,
    delivery: Delivery,
  ): Promise<{ readonly failureCount: number; readonly disabled: boolean }> {
    const failures = delivery.ok ? sql`0` : sql`${webhooks.failureCount} + 1`;
    const [row] = await this.db
      .update(webhooks)
      .set({
        failureCount: failures,
        lastStatus: delivery.status,
        lastDeliveredAt: delivery.at,
        disabledAt: delivery.ok
          ? webhooks.disabledAt
          : sql`case when ${failures} >= ${delivery.disableAfter} then ${delivery.at.toISOString()}::timestamptz else ${webhooks.disabledAt} end`,
      })
      .where(this.one(organizationId, id))
      .returning({ failureCount: webhooks.failureCount, disabledAt: webhooks.disabledAt });
    return { failureCount: row?.failureCount ?? 0, disabled: row?.disabledAt != null };
  }

  private one(organizationId: OrganizationId, id: WebhookId) {
    return and(eq(webhooks.organizationId, organizationId), eq(webhooks.id, id));
  }

  private static record(row: WebhookRow): WebhookRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      kind: row.kind,
      encryptedUrl: row.encryptedUrl,
      urlHint: row.urlHint,
      encryptedSecret: row.encryptedSecret,
      events: row.events,
      disabledAt: row.disabledAt,
      failureCount: row.failureCount,
      lastStatus: row.lastStatus,
      lastDeliveredAt: row.lastDeliveredAt,
      createdAt: row.createdAt,
    };
  }
}
