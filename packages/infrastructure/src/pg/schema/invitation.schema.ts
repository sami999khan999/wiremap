import {
  index,
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

// Only *pending* invitations. Accepting or revoking deletes the row and the audit log
// carries the history, so there is no status column to filter on.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Stored lowercased, and compared against the *verified* address on the user row —
    // which is what makes the token a locator rather than a credential.
    email: text("email").notNull(),
    // Declared rather than left to the default, and `no action` for the same reason
    // `memberships.role_id` is: a tenant delete cascades roles and invitations together.
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "no action" }),
    // The digest, never the token: a dump of this table holds no usable credential.
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One pending invitation per address per tenant; a re-invite replaces it.
    uniqueIndex("invitations_email_uq").on(t.organizationId, t.email),
    // The landing page and the accept endpoint arrive holding a token and no tenant, so
    // this index cannot lead with `organization_id`.
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    // `claimPending` finds a brand-new user's invitation by address alone.
    index("invitations_email_idx").on(t.email),
    index("invitations_role_idx").on(t.roleId),
    index("invitations_inviter_idx").on(t.invitedBy),
    // The nightly sweep's predicate. Without it that delete seq-scans every invitation
    // in the deployment, every night, to find the few that lapsed.
    index("invitations_expires_idx").on(t.expiresAt),
  ],
);
