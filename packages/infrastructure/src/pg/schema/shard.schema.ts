import {
  index,
  type OrganizationId,
  pgTable,
  smallint,
  sql,
  text,
  timestamp,
  uuid,
} from "../../import.js";

// The directory: which physical node holds a key's rows. A **catalog** table — it is
// read before any shard is known, which is what makes it the one place that can say.
export const shardAssignments = pgTable(
  "shard_assignments",
  {
    // The organization id as text, not a uuid column and not a foreign key: the key is
    // the strategy's to choose, and a fork sharding on region would put a region here.
    shardKey: text("shard_key").primaryKey(),
    // Physical, not virtual — decision D28 removed the level in between. Defaults to
    // zero, which is the only node an unsharded deployment has.
    node: smallint("node").notNull().default(0),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    // Null until the tenant has been moved. The move job reads it; nothing else does.
    movedAt: timestamp("moved_at", { withTimezone: true }),
    // Set while a move is in flight and cleared when it lands. Non-null is what the
    // write freeze reads: the tenant may be read on `node`, and written nowhere.
    movingTo: smallint("moving_to"),
    // When the source copy became reclaimable. The grace sweep reads this and nothing
    // else, for the reason `partition_archive.deleted_at` exists.
    sourceDroppableAt: timestamp("source_droppable_at", { withTimezone: true }),
    // The node the rows were copied *from*, kept so the grace sweep knows where to
    // look and a bad move can be flipped back without guessing.
    movedFrom: smallint("moved_from"),
  },
  (t) => [
    // For the move job and the shard map, both of which ask "what is on node 2".
    index("shard_assignments_node_idx").on(t.node),
    // Partial, so "what is reclaimable" is an index read rather than a walk of every
    // tenant this deployment has ever placed.
    index("shard_assignments_droppable_idx")
      .on(t.sourceDroppableAt)
      .where(sql`source_droppable_at is not null`),
  ],
);

// Tenants whose sixteen partitions exist and whose organization does not yet — `PF.3`.
// The founder claims one, so a signup pays no DDL. Catalog, and seeded on node 0 alone:
// ──
// the founder places every tenant there, and node 0 is the catalog's own database.
export const spareTenants = pgTable(
  "spare_tenants",
  {
    // Becomes `organizations.id` when claimed. Minted when the spare is made.
    id: uuid("id").$type<OrganizationId>().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Oldest first, so a spare whose runway has aged is the next one used.
  (t) => [index("spare_tenants_created_idx").on(t.createdAt)],
);
