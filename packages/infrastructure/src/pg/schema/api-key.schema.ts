import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { users } from "./auth.schema.js";
import { organizations } from "./rbac.schema.js";

// Not Better Auth's plugin, which mints a session per key so a leak impersonates a full
// user. See packages/auth/docs/reference/api-key.md.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuerId: uuid("issuer_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // First 8 characters of the token. Turns authentication into an indexed lookup
    // instead of a scan-and-compare over every key ever issued.
    prefix: text("prefix").notNull(),
    // sha256(token). The token itself is never stored, anywhere, ever — so a database
    // dump contains no usable credential.
    tokenHash: text("token_hash").notNull(),

    // Raw strings, filtered through `PermissionRegistry.isKnown()` before they are
    // trusted, so a stale row cannot grant a permission the registry no longer defines.
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.tokenHash),
    index("api_keys_prefix_idx").on(t.prefix),
    index("api_keys_issuer_idx").on(t.organizationId, t.issuerId),
    // For the cascade, not a query: deleting a user scans every row of this table
    // unless an index leads with the column the foreign key names.
    index("api_keys_issuer_fk_idx").on(t.issuerId),
  ],
);
