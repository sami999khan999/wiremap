// The runnable seed, above `src/` beside `drizzle.config.ts` — a build-time artefact,
// not library code. It lived at `src/pg/seed/index.ts` until `PgPersonalOrganizationEnroller`
// needed `SystemRoleSeed`: importing that folder barrel would have executed this script,
// connected to Postgres and called `process.exit` in the middle of a sign-in.

import { eq, Identifiers, Uuid } from "./src/import.js";
import { Database, DatabaseCluster } from "./src/pg/primitive/index.js";
import { organizations, shardAssignments } from "./src/pg/schema/index.js";
import { PlatformRoleSeed, SystemRoleSeed, TenantPartitionSeed } from "./src/pg/seed/index.js";
import { ShardScope, TransactionScope } from "./src/pg/transaction/index.js";

// The catalog's alone: the bootstrap tenant is node 0's, and a seed that looped nodes
// would create the same organization on every one of them.
const shards = new ShardScope();

// The same variable `apps/web/src/env.ts` reads. Naming it in both places is what
// keeps the organization the seed creates and the organization new users are enrolled
// into the same organization — a drift between the two is a sign-up that succeeds and
// a sign-in that fails, with nothing in either log saying why.
//
// Only `AUTH_ENROLMENT_MODE=bootstrap` reads it at runtime. Seeding it regardless is
// deliberate: `personal` and `invite` both leave a fresh database with no organization
// at all, and `pnpm db:studio` against an empty schema tells you nothing.
const SEED_SLUG = process.env.BOOTSTRAP_ORGANIZATION_SLUG ?? "loadbearing";

// Direct, for the same reason the migrator is: this runs once, against a database that
// may have no pooler in front of it yet.
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");

const database = new Database({ url });
const scope = new TransactionScope();

// One transaction, because the halves are not independently useful: an organization with
// no roles is a tenant nobody can be a member of, and a failure between them leaves one.
const organizationId = await database.client.transaction(async (tx) =>
  scope.within(tx, "catalog", async () => {
    // System roles are per-tenant rows, so a fresh database needs an organization to
    // hang them off before the seed has anything to write against.
    const existing = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, SEED_SLUG))
      .limit(1);

    const id = existing[0]?.id ?? Identifiers.organizationId.parse(Uuid.v7());

    if (!existing[0]) {
      await tx
        .insert(organizations)
        .values({ id, slug: SEED_SLUG, name: "Loadbearing", isPlatform: true });
    }

    // Marked every run, not only on create: a database seeded before the tier existed
    // has the organization and not the flag, and `organizations_platform_uq` makes
    // marking a second one an error rather than a silent second tier.
    await tx.update(organizations).set({ isPlatform: true }).where(eq(organizations.id, id));

    // In the same transaction as the organization, which is what lets `PgShardResolver`
    // throw on a missing row rather than guess node 0.
    await tx.insert(shardAssignments).values({ shardKey: id, node: 0 }).onConflictDoNothing();

    // Idempotent, and first: every tenant-owned table is partitioned by this id, so a
    // tenant with no partitions is a tenant the first write to it fails against.
    await new TenantPartitionSeed(DatabaseCluster.single(database), scope, shards).run(id);
    await new SystemRoleSeed(DatabaseCluster.single(database), scope, shards).run(id);
    // After the mark, because it resolves the organization by the flag rather than by
    // the slug: the tier is a property of a row, not of a name in an env file.
    await new PlatformRoleSeed(DatabaseCluster.single(database), scope, shards).run();
    return id;
  }),
);

await database.close();

console.log(`seed complete: ${organizationId}`);

// Said out loud, because the alternative is someone seeding a database, signing up, and
// landing in an organization of their own wondering where this one went.
if ((process.env.AUTH_ENROLMENT_MODE ?? "personal") !== "bootstrap") {
  console.log(
    `note: AUTH_ENROLMENT_MODE is not "bootstrap", so nothing joins ${SEED_SLUG} automatically.`,
  );
  console.log(
    "      It exists so a fresh database has a tenant to look at, and as the role template.",
  );
}
