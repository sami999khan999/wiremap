import {
  index,
  integer,
  type OrganizationId,
  pgTable,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { users } from "./auth.schema.js";
import { organizations, roles } from "./rbac.schema.js";

// A shareable invitation: no address, a role, and three ways to stop working — it
// expires, it runs out of uses, or it is revoked. Kept after it stops, for the counts.
export const invitationLinks = pgTable(
  "invitation_links",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // `no action`, as `invitations.role_id`: a tenant delete cascades both together.
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "no action" }),
    // The digest, never the token, for the reason `invitations.token_hash` gives.
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Null is unlimited until it expires.
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The join page arrives holding a token and no tenant, so this cannot lead with
    // `organization_id`. See docs/opinions/vocabulary.md on the exempt indexes.
    uniqueIndex("invitation_links_token_uq").on(t.tokenHash),
    index("invitation_links_org_idx").on(t.organizationId, t.createdAt),
    index("invitation_links_role_idx").on(t.roleId),
    index("invitation_links_creator_idx").on(t.createdBy),
  ],
);
