import {
  index,
  integer,
  type OrganizationId,
  type ProjectId,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type WebhookEventName,
  type WebhookId,
} from "../../import.js";

// An organization's outgoing webhooks, tenant-partitioned and routed: delivery reads them
// on the tenant's node. The URL and the secret are `SecretCipher` ciphertext.
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").$type<WebhookId>().notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    projectId: uuid("project_id").$type<ProjectId>(),
    kind: text("kind", { enum: ["generic", "slack"] }).notNull(),
    encryptedUrl: text("encrypted_url").notNull(),
    urlHint: text("url_hint").notNull(),
    encryptedSecret: text("encrypted_secret"),
    events: text("events").array().$type<WebhookEventName[]>().notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    lastStatus: integer("last_status"),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    index("webhooks_project_idx").on(t.organizationId, t.projectId),
  ],
);
