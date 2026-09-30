import { boolean, check, index, pgTable, smallint, sql, text, timestamp } from "../../import.js";
import { plans } from "./rbac.schema.js";

// **One row, forever.** `check (id = 1)` is what makes that a database guarantee rather
// than a convention: a second row would be a second deployment-wide answer.
export const platformPolicy = pgTable(
  "platform_policy",
  {
    id: smallint("id").primaryKey(),
    // A pause, not a power switch — decision 12. Off stops the consumer projecting and
    // nothing else: the connection stays, and the TTL is still converged nightly.
    projectionEnabled: boolean("projection_enabled").notNull().default(true),
    // Off by default, which is the safe direction: a replica read that is stale is a
    // correctness bug, and turning it on is a decision someone makes.
    replicaReadsEnabled: boolean("replica_reads_enabled").notNull().default(false),
    // How long a moved tenant's rows stay on the node it left. **Null is not zero**: it
    // means "use the deployment's own default", the way an absent retention row does.
    moveGraceDays: smallint("move_grace_days"),
    // What a new signup lands on. The column default on `organizations` only places the
    // orgs that existed when the column was added; the founders read this one.
    defaultPlanKey: text("default_plan_key")
      .notNull()
      .default("unlimited")
      .references(() => plans.key),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_policy_singleton_ck", sql`${t.id} = 1`),
    // One row, so this serves nothing a scan would not. §18 asks it of every foreign key.
    index("platform_policy_default_plan_idx").on(t.defaultPlanKey),
  ],
);
