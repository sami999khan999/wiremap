import {
  bigint,
  index,
  type OrganizationId,
  pgTable,
  primaryKey,
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
