import type { OrganizationId } from "@loadbearing/contracts";
import { eq } from "drizzle-orm";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { organizations } from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// This suite's `env.ts`: the one place it reads the environment, named in §3 and in
// Biome's overrides so the harness dials the port `.env` names rather than a literal.
// ──
// Direct rather than pooled — these specs run DDL a pooler cannot carry — and the
// fallback is what a checkout with no `.env` gets. Credentials are `ratchet` ([11]).
export const DATABASE_URL =
  process.env.DATABASE_DIRECT_URL ??
  process.env.DATABASE_URL ??
  "postgres://ratchet:ratchet@localhost:25432/ratchet";

const URL = DATABASE_URL;

export const openDatabase = (logger?: ConstructorParameters<typeof Database>[0]["logger"]) =>
  new Database(logger ? { url: URL, logger } : { url: URL });

// The slug `seed.ts` writes, which is what makes this resolve to one row rather than to
// whichever row Postgres returns first.
const SEED_SLUG = "loadbearing";

// Every spec here runs against the seeded organization rather than creating one, so a
// failed run leaves no rows behind to confuse the next.

// By slug and not by `limit(1)`: specs that found their own tenant run beside these, and
// an unordered pick hands one of those out to be deleted underneath its owner.
export const seedOrganizationId = async (database: Database) => {
  const rows = await database.client
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, SEED_SLUG))
    .limit(1);

  const id = rows[0]?.id;
  if (!id) throw new Error("run `pnpm db:seed` first");
  return id;
};

// Every tenant-owned table is partitioned by `organization_id`, so a spec that founds its
// own organization creates its partitions before it writes a row into one.
export const seedTenant = async (database: Database, organizationId: OrganizationId) => {
  const scope = new TransactionScope();
  await new TenantPartitionSeed(DatabaseCluster.single(database), scope, shards).run(
    organizationId,
  );
};

// And the inverse, for a spec that deletes the organization it founded: a dropped tenant
// leaves its partitions behind, and the next run of the same spec attaches over them.
export const dropTenant = async (database: Database, organizationId: OrganizationId) => {
  const scope = new TransactionScope();
  const unitOfWork = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");
  await new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    unitOfWork,
  ).dropTenantPartitions(organizationId);
};
