import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { organizations } from "./rbac.schema.js";

// **The export names and property keys are load-bearing**: the Drizzle adapter resolves a
// column by `schema[modelName][fieldName]`. Re-derive after an upgrade with `pnpm auth:tables`.

export const users = pgTable(
  "users",
  {
    // Not Better Auth's opaque string: `generateId` is `Uuid.v7()`, which is what lets
    // `user_id` be a real uuid foreign key on the domain tables.
    id: uuid("id").$type<UserId>().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").default(false),

    // ── ours, not Better Auth's ──
    // Read on the first server render of every request, which is why it is here rather than
    // in a preferences table that would need a join before anything can be rendered.
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone"),
    // The platform's lock on a compromised account, in every tenant at once. A state, not a
    // delete: the activity log points at this row forever. Deactivation is per membership.
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    // `set null`, because a tenant being deleted must not take the account with it.
    // `PgMembershipReader` re-checks membership before honouring it.
    lastActiveOrganizationId: uuid("last_active_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_last_active_organization_idx").on(t.lastActiveOrganizationId)],
);

// Not partitioned: rows are looked up by id, a predicate carrying no partition key, so
// every lookup would scan every partition. Bounded by expiry and swept nightly.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // The tenant every request downstream is scoped by, so a real foreign key rather than
    // a loose string: otherwise a session can name a deleted organization.
    activeOrganizationId: uuid("active_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Desktop sessions are longer-lived and revocable independently, and that query needs
    // a column rather than a user-agent guess.
    surface: text("surface", { enum: ["web", "desktop"] }).notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Postgres does not index a foreign key, and without one each ON DELETE CASCADE scans
    // the whole table.
    index("sessions_user_idx").on(t.userId),
    index("sessions_organization_idx").on(t.activeOrganizationId),
    // What makes the nightly expiry sweep cheap, and the reason partitioning is not needed.
    index("sessions_expires_idx").on(t.expiresAt),
    // "Revoke this person's desktop sessions" as an indexed lookup rather than a scan.
    index("sessions_user_surface_idx").on(t.userId, t.surface),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    // The password hash, for the email-and-password provider. Better Auth owns the
    // hashing; nothing in this repository reads this column.
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    // Better Auth resolves a sign-in by `(providerId, accountId)` and takes the first row
    // it finds. Two rows for one Google account is two identities sharing one login.
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

// Exists only because `verification.storeInDatabase` is set: without it these tokens
// live on the LRU instance, where an eviction silently breaks a reset link.
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verifications_identifier_idx").on(t.identifier),
    index("verifications_expires_idx").on(t.expiresAt),
  ],
);

export const twoFactors = pgTable(
  "two_factors",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").default(false),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  // One secret per user: a second row is an enrolment that verifies against a device the
  // person no longer has, and the lookup would not say which of the two it used.
  (t) => [uniqueIndex("two_factors_user_idx").on(t.userId)],
);
