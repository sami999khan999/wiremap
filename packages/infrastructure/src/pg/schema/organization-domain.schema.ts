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

// A claimed email domain. A verified sign-up at it joins the organization with `role_id`
// instead of founding one of its own.
export const organizationDomains = pgTable(
  "organization_domains",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Lower case, without a trailing dot: `MemberDomainRules.normalise` wrote it.
    domain: text("domain").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "no action" }),
    createdBy: uuid("created_by")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One organization per domain, across the deployment: a sign-up arrives holding an
    // address and no tenant. See docs/opinions/vocabulary.md on the exempt indexes.
    uniqueIndex("organization_domains_domain_uq").on(t.domain),
    index("organization_domains_org_idx").on(t.organizationId),
    index("organization_domains_role_idx").on(t.roleId),
    index("organization_domains_creator_idx").on(t.createdBy),
  ],
);
