import {
  check,
  type DocSpaceId,
  index,
  type OrganizationId,
  pgTable,
  sql,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { users } from "./auth.schema.js";
import { organizations, plans } from "./rbac.schema.js";

// Who outside the platform may read a `granted` space. Catalog: it points across tenants
// and is read before a request is placed. See application/docs/reference/doc.md.
export const docSpaceGrants = pgTable(
  "doc_space_grants",
  {
    id: uuid("id").primaryKey(),
    // No key: the space is a routed row on the platform organization's node, and Postgres
    // enforces no key across two databases. A space's delete clears its grants after.
    spaceId: uuid("space_id").$type<DocSpaceId>().notNull(),
    // Exactly one of the three, by the check below. Named for what they hold rather than
    // `organization_id`, which would make §17 read this as a tenant's table.
    granteeOrganizationId: uuid("grantee_organization_id")
      .$type<OrganizationId>()
      .references(() => organizations.id, { onDelete: "cascade" }),
    granteeUserId: uuid("grantee_user_id")
      .$type<UserId>()
      .references(() => users.id, { onDelete: "cascade" }),
    granteePlanKey: text("grantee_plan_key").references(() => plans.key, { onDelete: "cascade" }),
    // Required: a grant nobody can explain is one nobody dares revoke.
    reason: text("reason").notNull(),
    // Null never lapses, which is what a plan's grant usually wants.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // No key, as on `entitlement_adjustments`: a departed admin must not take the grant.
    createdBy: uuid("created_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "doc_space_grants_one_grantee_ck",
      sql`num_nonnulls(${t.granteeOrganizationId}, ${t.granteeUserId}, ${t.granteePlanKey}) = 1`,
    ),
    check("doc_space_grants_reason_ck", sql`char_length(${t.reason}) between 1 and 500`),
    // One per kind, each partial: a nullable column in a unique index enforces nothing for
    // the rows where it is null, and every row here is null in two of the three.
    uniqueIndex("doc_space_grants_organization_uq")
      .on(t.spaceId, t.granteeOrganizationId)
      .where(sql`${t.granteeOrganizationId} is not null`),
    uniqueIndex("doc_space_grants_user_uq")
      .on(t.spaceId, t.granteeUserId)
      .where(sql`${t.granteeUserId} is not null`),
    uniqueIndex("doc_space_grants_plan_uq")
      .on(t.spaceId, t.granteePlanKey)
      .where(sql`${t.granteePlanKey} is not null`),
    index("doc_space_grants_organization_fk_idx").on(t.granteeOrganizationId),
    index("doc_space_grants_user_fk_idx").on(t.granteeUserId),
    index("doc_space_grants_plan_fk_idx").on(t.granteePlanKey),
  ],
);
