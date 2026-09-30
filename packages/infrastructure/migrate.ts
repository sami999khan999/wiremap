import { shardUrls } from "./shard-env.js";
import { migrate, type OrganizationId, sql } from "./src/import.js";
import { Database, DatabaseCluster } from "./src/pg/primitive/index.js";
import { TenantPartitionSeed } from "./src/pg/seed/index.js";
import { ShardScope, TransactionScope } from "./src/pg/transaction/index.js";

// Nothing here is ever placed by a resolver: the loop names the node, and every
// repository it builds is a one-node cluster over that node's connection.
const shards = new ShardScope();

// Paged rather than read whole: this runs before the web app can take a request, and a
// deployment with ten thousand tenants should not hold them all in memory to do it.
const PAGE = 500;

// Direct, never pooled. Migrations run DDL and `0022` sets a role default, and a
// transaction pooler is the wrong place for either.
const nodes = shardUrls().map((shard) => new Database({ url: shard.directUrl }));
const catalog = nodes[0];
if (!catalog) throw new Error("DATABASE_URL is required.");

// Catalog first, and in index order, so a later node's backfill reads a directory that
// has already been migrated.
for (const [index, node] of nodes.entries()) {
  await migrate(node.client, { migrationsFolder: "./migrations" });
  console.log(`migrations applied on node ${index}`);
}

// `0023` creates the partitioned parents and no children, so until this loop has run
// every tenant-owned table rejects every insert. One implementation creates partitions;
// a SQL copy of it in the migration would be a second one that drifts.
const scope = new TransactionScope();

let tenants = 0;
let created = 0;

for (const [index, node] of nodes.entries()) {
  const partitions = new TenantPartitionSeed(DatabaseCluster.single(node), scope, shards);
  let after: OrganizationId | null = null;

  for (;;) {
    // `coalesce(node, 0)`, so a tenant whose directory row `0031` has not reached yet
    // is node 0's — the same answer an unsharded deployment gives for every tenant.
    const page: { rows: { id: OrganizationId }[] } = await catalog.client.execute(sql`
      select o.id::text as id
      from organizations o
      left join shard_assignments sa on sa.shard_key = o.id::text
      where coalesce(sa.node, 0) = ${index}
        ${after ? sql`and o.id > ${after}::uuid` : sql``}
      order by o.id
      limit ${PAGE}
    `);

    if (page.rows.length === 0) break;

    // One read for the page, then a transaction per tenant that is short of something:
    // a long DDL transaction holds locks the whole time, and most deploys need none.
    const short = await partitions.missing(page.rows.map((row) => row.id));
    for (const id of short) {
      await node.client.transaction(async (tx) =>
        scope.within(tx, "catalog", async () => {
          created += (await partitions.run(id)).length;
        }),
      );
    }
    tenants += page.rows.length;

    after = page.rows[page.rows.length - 1]?.id ?? null;
    if (page.rows.length < PAGE) break;
  }
}

for (const node of nodes) await node.close();

console.log(
  `migrations applied; ${created} partitions ensured across ${tenants} tenants on ${nodes.length} node(s)`,
);
