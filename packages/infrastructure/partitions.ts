// The runway, by hand. `MaintenanceConsumer` does this monthly; this is the same routine
// for the operator whose worker was down on the first of the month.
//
// `--sweep <organization_id>` is the other half: cold storage outlives a tenant, and
// until a delete use-case enqueues the job, this is what reaches it.

import { shardUrls } from "./shard-env.js";
import { type OrganizationId, PartitionedTable, sql } from "./src/import.js";
import { Database, DatabaseCluster } from "./src/pg/primitive/index.js";
import { PgMaintenanceGateway, PgPartitionArchiveGateway } from "./src/pg/repository/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "./src/pg/transaction/index.js";
import { S3StorageGateway } from "./src/s3/index.js";

// Nothing here is ever placed by a resolver: the loop names the node, and each
// gateway is a one-node cluster over that node's connection.
const shards = new ShardScope();

// The same three the schedule keeps ahead — the current month and the next two — so
// running this by hand cannot leave a different runway from running it on the clock.
const MONTHS = 3;

// Tenants per page, the same size the worker walks them in.
const PAGE = 200;

// Direct, never pooled: this is DDL, and a transaction pooler is the wrong place for it.
const nodes = shardUrls().map((shard) => new Database({ url: shard.directUrl }));
const catalog = nodes[0];
if (!catalog) throw new Error("DATABASE_URL is required.");

const scope = new TransactionScope();
const gatewayFor = (node: Database) => {
  const cluster = DatabaseCluster.single(node);
  return new PgMaintenanceGateway(
    cluster,
    scope,
    shards,
    new PgUnitOfWork(cluster, scope, shards, "catalog"),
  );
};
const now = new Date();

const sweepAt = process.argv.indexOf("--sweep");

// A tenant's cold objects, deleted before the rows that name them. Deleting the tenant
// in Postgres cascades cleanly and leaves every one of its S3 objects behind.
if (sweepAt !== -1) {
  const organizationId = process.argv[sweepAt + 1];
  if (!organizationId) throw new Error("--sweep needs an organization id.");

  // Read here rather than through `env.ts`: this is a script above `src/`, the one
  // category allowed to read the environment directly.
  const storage = new S3StorageGateway({
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
    // `=== "true"`, the way both `env.ts` schemas read it. `!== "false"` defaulted this
    // script to path-style against real S3, where the addressing is by host.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });

  // The catalog's, and only the catalog's: `partition_archive` is one index for the
  // deployment, so a sweep that looped nodes would delete the same objects N times.
  const archive = new PgPartitionArchiveGateway(
    DatabaseCluster.single(catalog),
    scope,
    shards,
    storage,
  );
  const objects = await archive.sweep(organizationId as OrganizationId);

  for (const node of nodes) await node.close();
  console.log(`swept ${objects} cold objects for ${organizationId}`);
  process.exit(0);
}

interface Row {
  readonly node: number;
  readonly table: string;
  readonly tenant: string;
  readonly created: number;
  readonly ahead: number;
}

const rows: Row[] = [];

// Read *before* ensuring, for the reason the consumer gives: afterwards there is nothing
// to report, because the run has just fixed whatever it found.
const cover = async (
  node: number,
  maintenance: PgMaintenanceGateway,
  table: (typeof PartitionedTable.NAMES)[number],
  tenant: OrganizationId | null,
) => {
  const ahead = await maintenance.monthlyPartitionsAfter(table, tenant, now);
  const created = await maintenance.ensureMonthlyPartitions(table, tenant, now, MONTHS);

  rows.push({ node, table, tenant: tenant ?? "—", created: created.length, ahead });
};

// A partition is physical, so the runway is per node — and the tenants are read from
// the catalog's directory rather than ensured everywhere.
for (const [index, node] of nodes.entries()) {
  const maintenance = gatewayFor(node);

  for (const entry of PartitionedTable.MONTH_PARTITIONED) {
    if (!entry.tenantKey) {
      await cover(index, maintenance, entry.name, null);
      continue;
    }

    let after: OrganizationId | null = null;

    for (;;) {
      // Annotated, because `after` is read inside the query that produces `page` and
      // written from it below — inferred, that is a circular initializer (TS7022).
      const page: { readonly rows: readonly { id: OrganizationId }[] } =
        await catalog.client.execute<{ id: OrganizationId }>(sql`
        select o.id::text as id
        from organizations o
        left join shard_assignments sa on sa.shard_key = o.id::text
        where coalesce(sa.node, 0) = ${index}
          ${after ? sql`and o.id > ${after}::uuid` : sql``}
        order by o.id
        limit ${PAGE}
      `);

      if (page.rows.length === 0) break;
      for (const { id } of page.rows) await cover(index, maintenance, entry.name, id);

      after = page.rows[page.rows.length - 1]?.id ?? null;
      if (page.rows.length < PAGE) break;
    }
  }
}

for (const node of nodes) await node.close();

// `ahead` is what existed before this run, so a zero there is the reading that matters:
// it says the next insert past month end would have failed.
console.table(rows);

const starved = rows.filter((row) => row.ahead < 2);
if (starved.length > 0) {
  console.log(`${starved.length} of ${rows.length} had under two months of runway.`);
}
