import {
  boolean,
  type OrganizationId,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { organizations } from "./rbac.schema.js";

// An organization's Ask settings, its model key encrypted. One row per organization, in
// the catalog with the rest of its configuration.
export const organizationAi = pgTable(
  "organization_ai",
  {
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    provider: text("provider", { enum: ["none", "gemini"] })
      .notNull()
      .default("none"),
    model: text("model").notNull(),
    encryptedKey: text("encrypted_key"),
    keyHint: text("key_hint"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per organization, and the foreign key's own index.
  (t) => [uniqueIndex("organization_ai_organization_uq").on(t.organizationId)],
);
