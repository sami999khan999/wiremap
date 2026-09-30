# 13 · `@loadbearing/infrastructure` — the Postgres side

> Drizzle schema, the connection class, repository implementations, migrations, and seeds.
> Server-only.
>
> **This document used to build a separate database package.** It was folded into
> `@loadbearing/infrastructure` — the two were siblings with no edge between them, and the split put
> one seam in two places. Everything below is now `packages/infrastructure/src/pg/`; the other stores
> are [15](15-infrastructure-package.md).

**Delivers:** RBAC tables with `organization_id` on every one, `CapabilityRepository`, a migration pipeline whose first migration is already partitioned, and the four system roles.

**Prerequisite:** [12 · `@loadbearing/application`](12-application-package.md)

---

## Layout

**One folder per seam, plus one folder for every table.** The adapters are organised the way [15](15-infrastructure-package.md) organises its own — a folder per port, holding the class that implements it. The tables are not: they all live in `schema/`, because two tools require a single entry that names every one of them.

That split has a real cost, and it is worth naming rather than discovering. A slice's files land in two directories — `schema/task.schema.ts` and `task/pg-task.repository.ts` — so a `CODEOWNERS` line per team needs both globs. [Folders](../opinions/folders.md) argues the other way for every package that has a choice; this one does not.

```
packages/infrastructure/
├── drizzle.config.ts
├── migrations/                    ← generated, committed
└── src/
    ├── index.ts                   ← ServerOnly.assert() first among the statements
    ├── import.ts                  ← every external symbol, drizzle and pg included
    ├── schema/                    ← every table; index.ts is the drizzle-kit entry
    │   ├── index.ts               ← the one `export *` in the repository
    │   ├── rbac.schema.ts         → roles, role_permissions, memberships, …
    │   ├── auth.schema.ts         ← Better Auth CLI output, committed
    │   ├── activity.schema.ts     ← activity_log, partitioned monthly
    │   ├── archive.schema.ts      ← partition_archive, the index into S3 cold/
    │   └── vector.schema.ts       ← document_chunks — see 14
    ├── primitive/                 ← what every seam folder depends on
    │   ├── index.ts
    │   ├── database.ts            → Database, DatabaseConfig, DrizzleClient
    │   └── base.repository.ts     → BaseRepository
    ├── transaction/               ← the UnitOfWork seam
    │   ├── index.ts
    │   ├── transaction-scope.ts   → TransactionScope
    │   └── pg-unit-of-work.ts     → PgUnitOfWork
    ├── repository/                ← every adapter, one file each, flat
    │   ├── index.ts
    │   ├── pg-activity.logger.ts          → PgActivityLogger
    │   ├── pg-partition-archive.gateway.ts → PgPartitionArchiveGateway
    │   ├── pg-api-key.repository.ts       → PgApiKeyRepository
    │   ├── pg-capability.repository.ts    → PgCapabilityRepository
    │   ├── pg-maintenance.gateway.ts      → PgMaintenanceGateway
    │   ├── pg-membership.reader.ts        → PgMembershipReader
    │   └── pg-vector.store.ts             → PgVectorStore — see 14
    ├── seed/                      → SystemRoleSeed, PlatformRoleSeed, TenantPartitionSeed
    └── migrate/                   ← the migration runner
```

**One folder per external system, and the system is the only subject.** This whole tree lives under
`packages/infrastructure/src/pg/`, beside `redis/`, `s3/`, `bullmq/`, `smtp/`, `openai/`,
`gemini/` and `unified/` ([15](15-infrastructure-package.md)).

**The adapters sit flat in `repository/` rather than in a folder per seam.** They were once
`activity/`, `analytics/`, `rbac/`, `vector/` and `maintenance/`, each holding one or two files, and
that was wrong twice over.

A folder holding one file is a path, not a subject ([Simplicity](../opinions/simplicity.md)). And
a seam folder under `pg/` hides a second implementation. In the big kit, `pg/analytics/` beside
`clickhouse/` read as two different things, when it was two implementations of one port. Flat,
each file is `pg-<port>.ts`, a second vendor's is `<vendor>-<port>.ts` one directory over, and the
technology stays the axis this package sorts on.

**Schemas are the exception to the subject-folder rule** ([Folders](../opinions/folders.md)), and it
is a tooling exception rather than a taste one: `drizzle.config.ts` needs one path that names every
table, and `drizzle(pool, { schema })` needs the same namespace at runtime or Better Auth's adapter
cannot find `users`/`sessions`/`accounts` at all — it resolves a model by looking the export name up
in that namespace ([16](16-auth-package.md)).


---

## Step 13.1 — The tripwire and the barrel

**`packages/infrastructure/src/pg/index.ts`**

```ts
export {
  BaseRepository,
  Database,
  type DatabaseConfig,
  type DrizzleClient,
} from "./primitive/index.js";
export {
  PgPartitionArchiveGateway,
  PgActivityLogger,
  PgApiKeyRepository,
  PgCapabilityRepository,
  PgMaintenanceGateway,
  PgMembershipReader,
  PgVectorStore,
} from "./repository/index.js";
export { PgUnitOfWork, TransactionScope } from "./transaction/index.js";
```

**`schema/`, `migrate/` and `seed/` are deliberately absent.** drizzle-kit and the two runners reach
them by path, and nothing outside this package may name a table.

The `ServerOnly.assert` tripwire lives one level up, in `packages/infrastructure/src/index.ts`, above
every export — so it runs the moment the module is evaluated in a browser rather than after a Drizzle
import has already been pulled in. `import` statements are hoisted regardless of where the assert
sits, so being first among the *statements* is what matters, not first in the file.

The assert sits above every export, so it runs the moment the module is evaluated in a browser rather than after a Drizzle import has already been pulled in. The two `import` lines above it are hoisted regardless of where the statement sits, so putting the assert first among the *statements* is what matters, not first in the file.

**`Database` builds the schema namespace with two statements, not `export * as schema from`.** That
form is a star export and `noReExportAll` rejects it ([05](05-lint-and-format.md)) — `import * as`
followed by a named use is the same thing to the module graph and passes.

---

## Step 13.2 — `Database`

**`packages/infrastructure/src/pg/primitive/database.ts`**

```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export class Database {
  private readonly pool: Pool;
  public readonly client: NodePgDatabase<typeof schema>;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.url,
      max: config.maxConnections ?? 10,
      statement_timeout: config.statementTimeoutMs ?? 30_000,
      idleTimeoutMillis: 30_000,
    });
    this.client = drizzle(this.pool, { schema });
  }

  public async healthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
```

**`statement_timeout` is not optional.** Without it, one accidental cross join holds a connection until someone notices, and with a pool of ten that is the whole application. Thirty seconds is generous for anything an HTTP request should be doing; the worker can construct its own `Database` with a longer timeout for batch work.

**`max: 10` per process, and count your processes.** Web instances plus worker instances multiply against your Postgres `max_connections`. Three web replicas and two workers at ten each is fifty connections, which is fine; at a hundred each it is not. This is the number to check first when connection-exhaustion errors appear.

**`Database` takes a config object, not a URL string.** It is one extra brace today and it means adding pool tuning later does not change every call site.

> **This is the shape doc 13 builds. It has since grown four things**, and the reasons are worth
> knowing before you copy the block above into a new project.
>
> `idleTimeoutMs` and `connectionTimeoutMs` join the config, the second because without it an
> unreachable Postgres holds a request for the OS default — longer than every timeout in front of
> it. `application_name` goes on the pool so `pg_stat_activity` names the process holding a
> connection; it is the one startup parameter a transaction pooler forwards rather than dropping.
> Lite dials Postgres directly, and the code is still written as if a pooler sat in front.
>
> `pool.on("error")` is registered unconditionally. `pg` emits it on an **idle** client whose socket
> died — a restarted Postgres, a failover, a pooler once one is added — where no caller is waiting and nothing else can catch it;
> `apps/worker` turns an uncaught exception into `exit(1)`, so the listener is the difference
> between a reconnect and an outage.
>
> And `statement_timeout` stops being the guarantee this section says it is the moment a
> transaction pooler is in front: it is sent as a startup parameter, pgBouncer drops it, and
> `SHOW statement_timeout` reads `0`. The baseline migration puts a role-level floor in place
> (below), and `PgUnitOfWork` raises it per transaction with `SET LOCAL`. Adding the pooler is
> [pgBouncer](../scale/pgbouncer.md). The big kit's own write-up is
> [`upstream:docs/infra/reference/pgbouncer.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/docs/infra/reference/pgbouncer.md).

---

## Step 13.3 — The schema

Drizzle tables stay **declarative** — the same data-shape exemption Zod schemas get. They are `pgTable` calls at module scope, not classes. **All access goes through repository classes**; nothing outside `packages/infrastructure/src` imports a table.

**`packages/infrastructure/src/pg/schema/rbac.schema.ts`**

```ts
import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { users } from "./auth.schema.js";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    scope: text("scope", { enum: ["org", "goal"] }).notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roles_key_uq").on(t.organizationId, t.key),
    index("roles_organization_idx").on(t.organizationId),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    // A raw string. Validated through PermissionRegistry.isKnown() before it is trusted.
    permission: text("permission").notNull(),
  },
  (t) => [uniqueIndex("role_permissions_uq").on(t.roleId, t.permission)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_uq").on(t.userId, t.roleId),
    index("memberships_user_idx").on(t.organizationId, t.userId),
    index("memberships_role_idx").on(t.roleId),
  ],
);

export const goalMembers = pgTable(
  "goal_members",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    goalId: uuid("goal_id").notNull(),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("goal_members_uq").on(t.goalId, t.userId, t.roleId),
    index("goal_members_user_idx").on(t.organizationId, t.userId),
    index("goal_members_goal_idx").on(t.goalId),
    index("goal_members_role_idx").on(t.roleId),
  ],
);

// Per-user overrides. effect='deny' beats every grant, including the wildcard.
export const permissionOverrides = pgTable(
  "permission_overrides",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id"), // null = org scope
    permission: text("permission").notNull(),
    effect: text("effect", { enum: ["grant", "deny"] }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("permission_overrides_user_idx").on(t.organizationId, t.userId),
    index("permission_overrides_goal_idx").on(t.goalId),
    uniqueIndex("permission_overrides_uq").on(t.userId, t.goalId, t.permission),
  ],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  memberships: many(memberships),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));
```

### Five modelling notes

**`user_id` is a real `uuid` foreign key to `users.id`, from the first migration.** That is only true because [16](16-auth-package.md) configures the auth library to mint `Uuid.v7()` identifiers rather than accepting its default opaque string. Take that configuration away and this column has to become `text` to match whatever format the library chose — which is the version of this document you may have read before, and the reason the constraint used to arrive a chapter late.

The ordering consequence is worth stating plainly: **these tables reference `users`, so `auth.schema.ts` has to exist before this migration is generated.** The two schema files are written together and land in one migration; there is no window in which `memberships` exists without the constraint.

**The constraint is declared here, in the schema, and never in a hand-authored migration.** drizzle-kit generates by diffing this file against the migration history, so a foreign key it cannot see is a foreign key the next generated migration drops — silently, and in the migration nobody reads closely because it was supposed to be about something else.

**What has not changed is that there is exactly one users table.** Generating your own alongside the auth library's and syncing them is the mistake that produces two identity systems, and no amount of correct column typing rescues it.

**`permission` is `text`, not an enum.** A Postgres enum would need a migration every time a permission is added, and the vocabulary lives in `PermissionRegistry` where it belongs. The column is untrusted text and `isKnown()` is the gate. This is the same reason `role_permissions` has no foreign key to a permissions table: there is no permissions table.

**`memberships_user_idx` and `goal_members_user_idx` are not optional.** `CapabilityRepository.resolveFor()` is the hottest query in the system — it runs on essentially every request that misses the capability cache — and it filters both tables by user. Without those indexes it is two sequential scans per request.

**`organization_id` is on every table, and it is the sharding key.** Not because multi-tenancy is planned, but because it is the one column that cannot be added cheaply later: retrofitting it means touching every table, every query, every permission check and every test, on a live database. It costs a column and a `WHERE` clause now. See [Data and scale](../opinions/data-and-scale.md) §4.1.

The consequence that catches people is **`roles_key_uq`**. Keyed on `(key)` alone, two organizations cannot both have an `owner` role — the second insert fails with a unique violation and it looks like a seeding bug. Every unique index on a tenant-scoped table leads with `organization_id`, and the ones that do not — `memberships_uq`, `goal_members_uq` — are already unique on columns that are themselves tenant-scoped.

**`partition_archive` leads with the tenant, and carries no foreign key to it.** It is the index into cold storage — one row per tenant per table per archived month, with the object key, the row count, the bytes and a per-action breakdown. In lite only a tenant delete writes it: the deleted tenant's months go to S3 `cold/`, and the nightly `retention` job sweeps them 30 days later. `projected_at` is kept for the analytics store and stays null in lite. Leading with `organization_id` is what lets one tenant's cold months be read, swept and totalled without touching another's, and is why it needs no `TENANT_EXEMPT` line. The missing foreign key is deliberate for the reason the audit trail gives about its actor: **the archive is what survives the tenant**, so a cascade would erase the record of what was kept. Deleting a tenant therefore has to sweep the objects itself. See [cold storage](../../packages/infrastructure/docs/reference/cold-storage.md).

**Postgres does not index foreign keys for you.** `roleId` on `memberships` and `goalMembers`, `goalId` on `goal_members` and `permission_overrides` — every one is a column something filters or joins on, and none of them is covered by the unique indexes above. An unindexed FK is also what makes deleting a role scan every membership row. The rule is mechanical: **every FK column gets an index, every filtered column gets an index**, and the review question is "which index serves this predicate" rather than "does this look slow".

---

## Step 13.4 — The schema barrel

**`packages/infrastructure/src/pg/schema/index.ts`**

```ts
export * from "./activity.schema.js";
export * from "./archive.schema.js";
export * from "./rbac.schema.js";
export * from "./vector.schema.js";
// …one line per schema file

```

One file that drizzle-kit points at, and one file to edit when a slice adds tables. Forgetting to add a slice here is the most common reason a new table does not appear in a generated migration.

> [!NOTE]
> **This is the only `export *` in the repository**, and it has its own `noReExportAll: "off"` override keyed on this exact path ([05](05-lint-and-format.md)). The rule elsewhere exists to keep a package's public surface deliberate; this file is not a public surface. `drizzle-kit` and `drizzle(pool, { schema })` need every table, relation, and enum the package defines, `index.ts` republishes the whole thing as one namespace, and hand-listing several dozen table objects would drift out of date on the first migration nobody double-checked.

---

## Step 13.5 — Drizzle Kit

**`packages/infrastructure/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

> This file reads `process.env` and that is fine — it is a build-time tool config, not package runtime code. No extra ignore is needed: the base config's `"**/*.config.ts"` pattern already covers it.

> [!IMPORTANT]
> **Every script in this section reads `DATABASE_DIRECT_URL ?? DATABASE_URL`, not `DATABASE_URL`.**
> Lite has no pooler, so the two are the same URL today. Once pgBouncer is in front
> ([pgBouncer](../scale/pgbouncer.md)), `DATABASE_URL` is the pooled port. `drizzle-kit` introspects
> and `db:studio` holds a session open; migrations run DDL and the baseline sets a role default. None of that belongs on a transaction pooler, and the fallback is
> what keeps a single-URL deployment working unchanged.

> **The catalog, and it does not loop.** Every node runs the same schema, so `drizzle-kit` and
> `db:studio` stay pointed at node 0 — generating against one database and applying to all is
> what `migrate.ts` is for. `DATABASE_SHARD_<n>_URL` is read by `shard-env.ts`, which sits above
> `src/` beside the scripts that use it; a script is the one category allowed to read the
> environment directly, and importing an app's `Env` here would make `pnpm db:migrate` parse the
> web app's whole schema.

Add to **`packages/infrastructure/package.json`**:

```json
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx migrate.ts",
  "db:push": "drizzle-kit push",
  "db:studio": "drizzle-kit studio",
  "db:seed": "tsx src/seed/index.ts"
}
```

**`packages/infrastructure/migrate.ts`**

```ts
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Database } from "./database.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required.");

const database = new Database({ url });
await migrate(database.client, { migrationsFolder: "./migrations" });
await database.close();

console.log("migrations applied");
```

```bash
pnpm add --filter @loadbearing/infrastructure -D dotenv
```

### Generate, never push

`db:push` diffs your schema against the database and applies the difference with no migration file. It is genuinely convenient and it is a trap:

- There is no record of what changed, so staging and production cannot be brought to the same state deterministically.
- It has no idea how to preserve data through a rename — it drops and recreates.
- Permission seeding lives in migrations ([12.8](#step-128--seeds)), so a pushed schema arrives with no roles.

Use `db:push` on a scratch database while iterating on a schema shape you have not committed. Use `db:generate` for anything that will ever reach another machine. **Migrations are committed** — they are the schema's history and CI replays them.

---

## Step 13.6 — First migration

```bash
cd packages/infrastructure
node -e "require('fs').writeFileSync('.env', 'DATABASE_URL=postgres://ratchet:ratchet@localhost:25432/ratchet\n')"
```
> A package-local `.env` for drizzle-kit only. It is already covered by the root `.gitignore`.

```bash
pnpm db:generate
```
> Writes the next `migrations/<nnnn>_<name>.sql` and updates `migrations/meta/`. Lite starts from one squashed baseline, `0000_lite_baseline.sql`, then `0001_doc_owner_audience.sql` and `0002_chunk_embedding_model.sql`. **Read the SQL before applying it.** Drizzle-kit is good but it is a diffing tool, and reviewing generated DDL is a five-second habit that catches an accidental `DROP COLUMN` before it runs.

### Hand-edit the partitioned tables, before you apply it

`activity_log` and `task_status_history` are append-only, grow forever, and are always queried by a recent time window. Both are **RANGE-partitioned by month, in this first migration** — converting a large table to partitioned later is a rewrite with downtime, and it is the one structural decision on this page that is genuinely painful to retrofit.

**Drizzle cannot express `PARTITION BY`.** The schema declares an ordinary table so the query builder still types it, and the clause is written onto the generated DDL afterwards. That is not a workaround bolted on — it is why migrations here are generated, read, and committed rather than pushed, and it is the same channel the permission-seeding SQL below already uses.

**`pnpm db:generate` does that edit for you, and refuses rather than guessing.** It is two halves — `drizzle-kit generate && tsx partition-ddl.ts` — and the second opens only the migration just written. A primary key that omits a partition key stops the run with *"declare the composite primary key in the schema; the generator does not synthesize keys"*, because drizzle emits the composite form only when the schema declares `primaryKey({ columns })`. A table an earlier migration already created unpartitioned stops it too: converting a live table is a copy-and-swap, written by hand. See [partitions](../../packages/infrastructure/docs/reference/partitions.md).

**A hand edit is the one change no linter reads, so an assertion does.** `check-architecture` §21 parses the `PARTITION BY` clause out of every file in `migrations/`, requires the table to be in `PartitionedTable.ALL` with the same level and key, requires the statement's primary key to carry every partition key, and fails on a `DEFAULT` partition — the edit you forget to make and the edit you make wrongly, from the same read. It also runs the other way: an allowlist entry no migration partitions fails too. See [26](26-hygiene-and-ci.md) and [partitions](../../packages/infrastructure/docs/reference/partitions.md).

**Every script that writes DDL walks every node, in index order, catalog first.** `migrate.ts`
applies the migrations to each `directUrl` and then seeds each node's own tenants — read from the
catalog's `shard_assignments`, with `coalesce(node, 0)` so a tenant the backfill has not reached
yet is node 0's. `partitions.ts` does the same for the runway and prints the node in its table.
`seed.ts` is the exception and stays on the catalog: the bootstrap organization is node 0's, and
it writes its own directory row in the same transaction. Order matters — the catalog is migrated
first, because a later node's backfill reads a directory that has to exist.

**Every tenant-owned table takes a tenant level first, and a migration creates parents only.** The shape is `PARTITION BY LIST ("organization_id")`, with `PARTITION BY RANGE` again under each tenant for the tables that grow with activity. Children — each tenant's partition and its runway months — are created by `TenantPartitionSeed` in the same transaction as the `organizations` insert, and by `migrate.ts` for every organization that already exists. One implementation creates partitions; a SQL copy of it in a migration is a second one that drifts.

Replace the generated `CREATE TABLE activity_log (...)` with:

```sql
CREATE TABLE activity_log (
  id              uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  actor_id        uuid        NOT NULL,
  action          text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX activity_log_org_time_idx ON activity_log (organization_id, occurred_at DESC);

CREATE TABLE activity_log_2026_01 PARTITION OF activity_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

**The primary key is `(id, occurred_at)`, not `id`.** Postgres requires a partitioned table's primary key to include the partition key, and the same applies to every unique index on it. This is the one place the "every primary key is a UUID" rule from [07](07-core-package.md) does not hold — and it costs nothing, because `Uuid.v7()` is time-ordered, so the key and the partition column increase together and inserts still land at the tail of the B-tree.

**Create partitions ahead of time**, with a repeatable job on the maintenance queue ([25](25-worker-app.md)) or `pg_partman`. A month that arrives with no partition is an insert that fails, so the job runs monthly and creates several months out.

**The platform tier's own table is the other exemption.** `platform_policy` is one row for the whole deployment. Its property is the one to copy: **an absent value is the code default**, so an empty table behaves exactly as the deploy before the table existed.

**Know what retention does here: nothing, yet.** Lite keeps every month partition and drops none. The usual shape is 12–24 months of detail in Postgres and older partitions archived to cold storage, because detaching a partition is instant while a `DELETE` over the same rows bloats the table and holds a lock. The archive path already exists for a tenant delete: each month is streamed to `cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz`, recorded in `partition_archive` and verified before the drop. A calendar retention pass is [Retention](../scale/retention.md). See [cold storage](../../packages/infrastructure/docs/reference/cold-storage.md).

**Which tables are partitioned is a list, not a convention.** `PartitionedTable.ALL` in `packages/application/src/primitive/partitioned-table.ts` names them; `MaintenanceGateway.ensureMonthlyPartitions` and `partitionsBefore` take that union rather than a `string`, and the monthly schedule loops it. Two things fall out. Postgres accepts no bind parameter in DDL — not for the table and not for the range bounds — so the adapter interpolates, and a closed union is the only boundary there is. And a table partitioned in a migration but never added to the list quietly stops getting partitions the month that migration's own runway ends.

`outbox_event` is the second table on that list. It is partitioned by `occurred_at` for the same reason `activity_log` is, and its indexes are partial rather than plain: the drain reads `WHERE published_at IS NULL` and a retention sweep reads `WHERE published_at IS NOT NULL`, so neither index carries rows the other will look at. Nothing is unique over `published_at`, so the pair are ordinary indexes — a nullable column in a *unique* index is the different problem [`vocabulary.md`](../opinions/vocabulary.md) warns about.

### Writing a unique-index migration

`pnpm db:generate` emits `CREATE UNIQUE INDEX` and nothing else. That statement is correct on an
empty database and **fails on every database that already holds a duplicate** — which is the only
kind of database that needs the index. The migration then aborts, its transaction rolls back, and
the deploy stops at a table nobody knew was dirty.

So a unique index arrives in three statements, in this order, in one migration:

```sql
DELETE FROM "accounts" a USING "accounts" b WHERE a."provider_id" = b."provider_id" AND a."account_id" = b."account_id" AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");
```

Three things make that shape work and are worth stating, because each one is a way it goes wrong:

- **The de-dup names a winner, and the rule is written down.** `(created_at, id) > (…)` keeps the
  earliest row per group — the original link — and the tuple comparison breaks the tie that
  `created_at` alone leaves open. Where the newest row is the right one, or where a flag decides
  (`two_factors` keeps the verified enrolment over a later abandoned one), say so in the `WHERE`
  rather than relying on physical order. A `DELETE` with no deterministic winner is a coin flip
  that two replicas can call differently.
- **`IF NOT EXISTS` on the create, `IF EXISTS` on a drop.** Drizzle's journal runs each migration
  once, but a migration also gets applied by hand — to a branch database, to a snapshot restored
  half-way — and the second run should be a no-op, not an error.
- **One migration, one transaction.** `migrate.ts` wraps a file's statements together, so the
  de-dup and the index either both land or neither does. Splitting them across two migrations opens
  a window where the duplicates are gone and the index that prevents new ones is not yet there.

Verify it against real duplicates, not an empty table: insert the collision by hand, run
`pnpm db:migrate`, and check that the row you meant to keep is the row that survived.

> **`session` looks like the third table on this list and is not.** Better Auth updates it on refresh, deletes it on sign-out, and looks rows up by id — a predicate carrying no partition key, so every lookup would scan every partition, and its generated schema will not produce the composite primary key partitioning requires. Sessions are bounded by expiry instead, and a `DELETE ... WHERE expires_at < now()` on the cleanup schedule is the right tool ([25](25-worker-app.md)).

```bash
pnpm db:migrate
```

```bash
pnpm db:studio
```
> Opens a browser UI at `local.drizzle.studio` showing your tables.

### Statements that change no table: the role settings

The last lines of `0000_lite_baseline.sql` are hand-written: three `ALTER ROLE CURRENT_USER SET`
statements, for `statement_timeout`, `idle_in_transaction_session_timeout` and `lock_timeout`. In the
big kit they were their own migration,
`upstream:packages/infrastructure/migrations/0022_pooler_timeout_floor.sql`. They are worth knowing
about for three reasons.

**They are the only enforcement of `statement_timeout` on a pooled connection.** The value `Database`
sends is a startup parameter; pgBouncer in transaction mode drops it, and the session reads `0`.
Lite has no pooler, but the floor is there for the day it does.

**`CURRENT_USER` is whoever ran `pnpm db:migrate`.** That role must be the role the application
connects as. Splitting them — the ordinary shape once a deployment has a DBA — lands the floor on
the migrator and leaves the application unlimited, silently.

**A role setting does not take effect on connections that are already open.** After changing one,
reconnect the pool: restart the processes in lite, or run `RECONNECT` on the pgBouncer console once
there is one.
[`upstream:docs/infra/reference/pgbouncer.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/docs/infra/reference/pgbouncer.md) has both.

---

## Step 13.7 — Repositories

**`packages/infrastructure/src/pg/primitive/base.repository.ts`**

```ts
import type { OrganizationId, UserId } from "@loadbearing/contracts";
import type { Database } from "./database.js";
import type { TransactionScope } from "./unit-of-work.js";

export abstract class BaseRepository {
  constructor(
    protected readonly database: Database,
    protected readonly scope: TransactionScope,
  ) {}

  // The transaction handle when one is open, the pool otherwise. Every query in
  // every subclass goes through this, which is what makes UnitOfWork real.
  protected get db() {
    return this.scope.current() ?? this.database.client;
  }

  // Every tenant-scoped query starts here. A repository method that does not
  // narrow by this is a cross-tenant read waiting to happen.
  protected tenant(actor: Principal): OrganizationId {
    return actor.organizationId;
  }
}
```

**Two things this base class exists to make unavoidable**, and both are cheap here and expensive everywhere else.

**The tenant filter.** Every repository query narrows by `organization_id`; the base class is where that becomes a habit rather than a review comment. A method that cannot be scoped to a tenant — a genuine cross-tenant aggregate — does not belong in a repository at all. It waits for an analytics store, which lite does not run ([Analytics](../scale/analytics.md), [Data and scale](../opinions/data-and-scale.md) §4.1).

**The transaction handle.** `db` resolves to the open transaction when there is one. Without that, `UnitOfWork.run()` opens a transaction that the repositories inside it never join — every call site *reads* as atomic and none of it *is*.

**`packages/infrastructure/src/pg/repository/pg-capability.repository.ts`**

```ts
import { and, eq, isNull, or } from "drizzle-orm";
import type { CapabilityRepository } from "@loadbearing/application";
import type { OrganizationId } from "@loadbearing/contracts";
import {
  CapabilitySet,
  PermissionRegistry,
  type CapabilitySetDto,
  type PermissionKey,
  type ScopedSetDto,
} from "@loadbearing/permissions";
import { BaseRepository } from "../base.repository.js";
import { goalMembers, memberships, permissionOverrides, rolePermissions } from "./rbac.schema.js";

interface MutableScoped {
  grants: Set<PermissionKey>;
  denies: Set<PermissionKey>;
}

export class PgCapabilityRepository extends BaseRepository implements CapabilityRepository {
  // Org role grants + goal role grants + per-user overrides, with deny winning.
  // Every raw permission string passes PermissionRegistry.isKnown() before it is
  // trusted, so a stale row can never grant a capability the registry no longer
  // defines.
  public async resolveFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<CapabilitySet> {
    const registry = PermissionRegistry.instance;

    const org: MutableScoped = { grants: new Set(), denies: new Set() };
    const goals = new Map<string, MutableScoped>();
    const scopedFor = (goalId: string): MutableScoped => {
      const existing = goals.get(goalId);
      if (existing) return existing;
      const created: MutableScoped = { grants: new Set(), denies: new Set() };
      goals.set(goalId, created);
      return created;
    };

    const orgRows = await this.db
      .select({ permission: rolePermissions.permission })
      .from(memberships)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, memberships.roleId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
        ),
      );

    for (const row of orgRows) {
      if (registry.isKnown(row.permission)) org.grants.add(row.permission);
    }

    const goalRows = await this.db
      .select({ goalId: goalMembers.goalId, permission: rolePermissions.permission })
      .from(goalMembers)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, goalMembers.roleId))
      .where(
        and(
          eq(goalMembers.organizationId, organizationId),
          eq(goalMembers.userId, userId),
        ),
      );

    for (const row of goalRows) {
      if (registry.isKnown(row.permission)) scopedFor(row.goalId).grants.add(row.permission);
    }

    const overrideRows = await this.db
      .select()
      .from(permissionOverrides)
      .where(
        and(
          eq(permissionOverrides.organizationId, organizationId),
          eq(permissionOverrides.userId, userId),
        ),
      );

    for (const row of overrideRows) {
      if (!registry.isKnown(row.permission)) continue;
      const target = row.goalId ? scopedFor(row.goalId) : org;
      if (row.effect === "deny") target.denies.add(row.permission);
      else target.grants.add(row.permission);
    }

    const freeze = (scoped: MutableScoped): ScopedSetDto => ({
      grants: [...scoped.grants],
      denies: [...scoped.denies],
    });

    const dto: CapabilitySetDto = {
      wildcard: false,
      org: freeze(org),
      goals: Object.fromEntries([...goals].map(([id, scoped]) => [id, freeze(scoped)])),
    };

    return CapabilitySet.from(dto);
  }
}
```

**Three queries, not one.** A single query with three left joins produces a cartesian product across role permissions, goal memberships, and overrides — for a user in five goals with four roles that is hundreds of rows to deduplicate in application code. Three targeted queries are faster and the code is readable.

**Three, and an integration test should say so.** "Three queries" is a claim that decays silently — someone adds a lookup inside the loop and it becomes 3 + N, which is invisible at ten users and fatal at five thousand. Assert the count rather than the timing:

```ts
const counted = await countQueries(() => repository.resolveFor(orgId, userId));
expect(counted).toBe(3);
```

An N+1 caught by a failing assertion costs a minute. The same N+1 caught by a production trace costs an afternoon and a rollback. This is the cheapest performance guardrail available and it belongs on every repository method that loops.

**`organizationId` scopes all three queries, and it is a parameter rather than ambient state.** A user can belong to more than one organization; without the tenant predicate `resolveFor` merges their capabilities across all of them. Nothing downstream can catch that, because by the time the `CapabilitySet` exists it is already wrong — every `can()` call after it returns a confidently incorrect answer.

**`isKnown()` filters every raw string on the way in.** This is the line that makes the deny-by-default model honest against a database that has outlived several refactors.

**This method is cached in [16](16-auth-package.md)**, not here. The repository does the correct expensive thing; `CapabilityCache` decides how often it runs. Mixing the two means the cache cannot be tested independently and invalidation has nowhere clean to live.

### The naming rule for implementations

`PgCapabilityRepository`, `PgActivityLogger`, `PgVectorStore` — implementations lead with their technology, because the prefix is what marks them as the swappable one. That is the second exemption to folder-prefix symmetry (the first is use-cases, which lead with a verb). The filename still mirrors the class: `capability.repository.ts` exports `PgCapabilityRepository`, and the `Pg` prefix is dropped from the filename because the folder already says `pg`.

---

## Step 13.8 — Seeds

**`packages/infrastructure/src/pg/seed/system-role.seed.ts`**

```ts
import { and, eq, inArray } from "drizzle-orm";
import { Uuid } from "@loadbearing/core";
import type { OrganizationId } from "@loadbearing/contracts";
import { PermissionRegistry, type PermissionKey } from "@loadbearing/permissions";
import { BaseRepository } from "../base.repository.js";
import { rolePermissions, roles } from "../schema/index.js";

interface SystemRole {
  readonly key: string;
  readonly name: string;
  readonly scope: "org" | "goal";
  readonly permissions: readonly PermissionKey[] | "all";
}

export class SystemRoleSeed extends BaseRepository {
  private static readonly ROLES: readonly SystemRole[] = [
    { key: "owner", name: "Owner", scope: "org", permissions: "all" },
    {
      key: "admin",
      name: "Administrator",
      scope: "org",
      permissions: ["rbac.role.read", "rbac.role.manage", "member.read", "member.invite"],
    },
    { key: "member", name: "Member", scope: "org", permissions: ["member.read"] },
    { key: "guest", name: "Guest", scope: "org", permissions: [] },
  ];

  private static readonly KEYS: readonly string[] = SystemRoleSeed.ROLES.map((r) => r.key);

  // Idempotent: safe to run on every deploy. Runs per organization, because
  // system roles are rows in a tenant's table rather than global constants.
  public async run(organizationId: OrganizationId): Promise<void> {
    // Write first, read after: `on conflict do nothing` makes one statement correct
    // for a tenant that has these rows and for one that does not.
    await this.db
      .insert(roles)
      .values(
        SystemRoleSeed.ROLES.map((definition) => ({
          id: Uuid.v7(),
          organizationId,
          key: definition.key,
          name: definition.name,
          scope: definition.scope,
          isSystem: true,
        })),
      )
      .onConflictDoNothing({ target: [roles.organizationId, roles.key] });

    // One `IN` for all four ids, including any a concurrent seed inserted a moment
    // ago — which is why this reads the table rather than trusting the ids above.
    const rows = await this.db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(
        and(
          eq(roles.organizationId, organizationId),
          inArray(roles.key, SystemRoleSeed.KEYS),
        ),
      );

    const idByKey = new Map(rows.map((row) => [row.key, row.id]));

    const grants = SystemRoleSeed.ROLES.flatMap((definition) => {
      const roleId = idByKey.get(definition.key);
      if (!roleId) return [];

      const permissions =
        definition.permissions === "all"
          ? PermissionRegistry.instance.all()
          : definition.permissions;

      return permissions.map((permission) => ({ organizationId, roleId, permission }));
    });

    if (grants.length === 0) return;

    await this.db.insert(rolePermissions).values(grants).onConflictDoNothing();

    // The half an insert cannot do — see "the seed reconciles" below.
    await this.reconcile(organizationId, [...idByKey.values()], grants);
  }
}
```

**Three statements, and the count does not grow with the number of roles.** The obvious shape — check whether each role exists, insert it if not, then insert its grants — is eleven round trips for four roles on a fresh tenant and seven on a re-seed, on a path that runs on **every organization creation**, which on `personal` enrolment means every sign-up. Write-then-read gets it to three and keeps it there when a fifth role is added.

**The read is not optional, and skipping it is the subtle bug.** `onConflictDoNothing` does not tell you which rows it skipped, so the ids generated above are correct only for the rows that actually landed. Reading `(organization_id, key)` back afterwards is also what makes a concurrent seed safe: two requests creating the same tenant race on `roles_key_uq`, one loses the insert, and both then read the same winning ids.

**The seed reconciles, it does not only add.** `onConflictDoNothing` makes the insert idempotent and
leaves the other direction open: a permission removed from the catalog, or dropped from a role's
list, stays granted forever. A fourth statement deletes the grants on the seeded roles that are no
longer in the intended set — one row-value `not in`, so it covers every role at once including the
one whose intended set is empty, which a per-role delete gets wrong.

**That delete is safe only because it is scoped to the seeded roles.** `RoleRules.assertEditable`
refuses to edit a system role, so nothing but this seed writes their grants; the same statement
pointed at a custom role would take back what an administrator granted through the UI.

**Assert the statement count in an integration test**, for the same reason [Step 13.7](#step-137--repositories) argues it for `resolveFor`: "four statements" is a claim that decays the first time someone adds a lookup inside a loop. The number is not the point — that it does not grow with the number of roles is.

```ts
expect(counter.count).toBe(4);
```

**`permissions: "all"` for owner resolves through `PermissionRegistry.all()` at seed time.** That means every new permission a feature adds is automatically granted to owners when the seed re-runs, which is what you want — and it is why the seed must be idempotent and re-run on every deploy rather than once at install.

**Every other role's permissions are explicit.** No wildcards outside owner. A role that grants "everything in module X" would keep granting new things as X grows, which is how a "read-only reviewer" role quietly acquires write access.

**The seed takes an organization, because system roles are per-tenant rows.** `owner` is not one row shared by every customer — it is one row per organization, which is what `roles_key_uq` on `(organization_id, key)` enforces. Creating an organization therefore means creating its four system roles, and this method is the thing that does it. Seeding a fresh database means seeding a first organization to hang them off.

**`packages/infrastructure/src/pg/seed/index.ts`**

```ts
import "dotenv/config";
import { Database } from "../database.js";
import { SystemRoleSeed } from "./system-role.seed.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required.");

const database = new Database({ url });
await new SystemRoleSeed(database).run();
await database.close();

console.log("seed complete");
```

```bash
pnpm db:seed
```

### `owner: "all"` stops at the tenant, and a second seed runs for the tier

`"all"` used to mean the whole catalog. Since the platform tier it means **the catalog minus the
platform scope**: a tenant owner holds every key their tenant has and is not a platform admin. The
seed's `reconcile()` is what makes that retroactive — a platform key an earlier deploy's `all`
handed out is taken back on the next run rather than left granted forever.

`PlatformRoleSeed` runs after it, and only for the organization marked `is_platform`. One role,
`platform_admin`, holding `PermissionRegistry.instance.byScope("platform")` resolved at seed time —
so a platform key a later phase adds reaches every admin on the next deploy rather than on a grant
somebody has to remember. `pnpm db:seed` marks the organization immediately before, every run, not
only on create: a database seeded before the tier existed has the organization and not the flag.

**The first admin cannot come through the API.** `GrantPermissionUseCase` refuses a key the granter
does not hold, which is the right rule and means nobody holds the first `platform.*` key to grant
it. `pnpm platform:grant <email>` puts one user into the platform organization as `platform_admin`;
every later one is invited through the members screen with that organization active. The long form
is [`permissions/docs/reference/platform-scope.md`](../../packages/permissions/docs/reference/platform-scope.md).

### Seeding versus migrating permissions

The seed grants permissions to **system** roles. Granting a new permission to a **custom** role that a customer created is a data migration, and it belongs in `migrations/` as a hand-written SQL file alongside the generated DDL. Drizzle-kit will not write it for you.

This is also the staged-rollout mechanism: until the migration that grants a module's permissions runs, the feature is invisible in the navigation and uncallable through the API, for everyone. That is not a limitation — it is the release switch.

**And the seed's own writes are one transaction with the organization it hangs them off.** The two
halves are not independently useful: an organization with no roles is a tenant nobody can be a
member of, and a failure between the insert and the seed leaves exactly that.

**The seeded organization is not joined under `personal` or `invite`, and the script says so.** Only
`AUTH_ENROLMENT_MODE=bootstrap` reads `BOOTSTRAP_ORGANIZATION_SLUG` at runtime; seeding it regardless
is deliberate — a fresh database with no organization at all tells you nothing in `db:studio`, and
the roles are the template every other tenant is seeded from. But someone who seeds, signs up under
`personal` and lands in an organization of their own needs to be told that rather than left to work
it out, so `pnpm db:seed` prints it.

---

## Step 13.9 — `PgUnitOfWork`

**`packages/infrastructure/src/pg/transaction/pg-unit-of-work.ts`** and **`transaction-scope.ts`**

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { UnitOfWork } from "@loadbearing/application";
import type { Database, DrizzleClient } from "./database.js";

// The seam BaseRepository reads. One instance, shared by the unit of work and
// every repository the container builds, so "am I in a transaction" has one answer.
export class TransactionScope {
  private readonly storage = new AsyncLocalStorage<DrizzleClient>();

  public current(): DrizzleClient | undefined {
    return this.storage.getStore();
  }

  public async within<T>(tx: DrizzleClient, work: () => Promise<T>): Promise<T> {
    return this.storage.run(tx, work);
  }
}

export class PgUnitOfWork extends UnitOfWork {
  constructor(
    private readonly database: Database,
    private readonly scope: TransactionScope,
  ) {
    super();
  }

  public override async run<T>(work: () => Promise<T>): Promise<T> {
    return this.database.client.transaction((tx) => this.scope.within(tx, work));
  }
}
```

**`AsyncLocalStorage` rather than threading a handle through every port.** The alternative is a `tx` parameter on every repository method, which puts a database concept into `application` — the one thing this architecture spends its effort keeping out. `AsyncLocalStorage` is a Node built-in, costs effectively nothing, and keeps the transaction invisible above this package.

This is the one place ambient context is acceptable, and it is worth being precise about why: the value is scoped to a single `run()` call rather than to a request, it is written in exactly one place, and nothing outside `BaseRepository` reads it. That is a different thing from a request-scoped container, which [17](17-composition-container.md) still bans.

**Nested `run()` calls join the outer transaction** rather than opening a second one, because `storage.run` replaces the handle only for the duration of the inner callback and Postgres has no nested transactions to open. A use-case that calls another use-case therefore gets one atomic unit, which is the behaviour anyone reading `run()` expects.

> **This is what makes the audit trail's guarantee real.** `PgActivityLogger` writes through the same `TransactionScope`, so a state change and its audit row commit together or neither does. A `UnitOfWork` whose repositories are not enrolled is worse than none at all — every call site reads as atomic, none of it is, and the first symptom is a state change with no record of who made it after a restart ([Data and scale](../opinions/data-and-scale.md) §1).

Verify it rather than trusting it — this is a five-line test and it is the only proof that matters:

```ts
await expect(
  uow.run(async () => {
    await tasks.save(task);
    throw new Error("boom");
  }),
).rejects.toThrow();

expect(await tasks.findById(task.id)).toBeNull();   // rolled back, not written
```

---

## ✅ Gate

```bash
pnpm db:generate && pnpm db:migrate && pnpm db:seed && pnpm db:studio
```

- `migrations/` contains a committed `.sql` file.
- Studio shows `organizations`, `roles`, `role_permissions`, `memberships`, `goal_members`, `permission_overrides`, `activity_log`.
- `SELECT key, is_system FROM roles;` returns four rows, all carrying the seed organization's id.
- Running `pnpm db:seed` a second time changes nothing.
- **Every table has the tenant column.** This returns no rows:
  ```sql
  SELECT t.table_name FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_name NOT IN ('organizations','user','session','account','verification','__drizzle_migrations')
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_name = t.table_name AND c.column_name = 'organization_id');
  ```
- **`activity_log` is partitioned.** `SELECT relkind FROM pg_class WHERE relname = 'activity_log';` returns `p`, not `r`.
- **Every foreign key has a covering index.** This returns no rows:
  ```sql
  SELECT conrelid::regclass AS tbl, conname FROM pg_constraint c
  WHERE contype = 'f' AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND (i.indkey::smallint[])[0] = c.conkey[1]);
  ```
- **The unit of work actually rolls back.** The five-line test in 13.9 passes.

Do not proceed until this passes.

---

[← `@loadbearing/application`](12-application-package.md) · [Vector Storage →](14-vector-store.md)
