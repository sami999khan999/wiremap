import {
  bigint,
  check,
  index,
  type OrganizationId,
  pgTable,
  primaryKey,
  smallint,
  sql,
  text,
  timestamp,
  uuid,
} from "../../import.js";
import { organizations } from "./rbac.schema.js";

// A GitHub App installation an organization has bound. One installation can serve two
// tenants (one GitHub account, two wiremap organizations), hence the composite key.
export const githubInstallations = pgTable(
  "github_installations",
  {
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountLogin: text("account_login").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.installationId] }),
    // The connect panel's list, in order; and the organization foreign key's own index.
    index("github_installations_organization_idx").on(t.organizationId, t.accountLogin),
    // A webhook arrives naming an installation and no tenant.
    index("github_installations_installation_idx").on(t.installationId),
  ],
);

// The deployment's GitHub App, when it was made from the platform screen. **One row**, held
// by `check (id = 1)` as `platform_policy` is: every tenant connects through the same App.
export const githubApps = pgTable(
  "github_apps",
  {
    id: smallint("id").primaryKey(),
    appId: text("app_id").notNull(),
    slug: text("slug").notNull(),
    htmlUrl: text("html_url").notNull(),
    ownerLogin: text("owner_login").notNull(),
    clientId: text("client_id").notNull(),
    // `SecretCipher` output. The private key reads every repository connected through it.
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptedWebhookSecret: text("encrypted_webhook_secret").notNull(),
    encryptedClientSecret: text("encrypted_client_secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("github_apps_singleton_ck", sql`${t.id} = 1`)],
);
