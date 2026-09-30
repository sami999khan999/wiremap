import { PartitionedTable, sql } from "../../src/import.js";
import { Database } from "../../src/pg/primitive/index.js";
import { DATABASE_URL } from "./database.js";

// Fifty names to one `drop table`, which takes the parent's lock once instead of fifty
// times. The whole sweep is housekeeping, so it also never runs long: see BUDGET.
const BATCH = 50;

// Partitions per run. Steady state is one test run's worth — about seven per tenant a
// spec founded and deleted — and a backlog larger than this clears over several runs.
const BUDGET = 500;

// A tenant partition whose organization row is gone. Nothing can reach it again and
// nothing will drop it — a partition is DDL, and since `24.1` no cascade runs at all.
const orphansOf = async (database: Database, table: string): Promise<readonly string[]> => {
  const found = await database.client.execute<{ child: string }>(sql`
    select c.relname as child
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = ${table}
      and c.relname ~ ${`^${table}_[0-9a-f]{32}$`}
      and not exists (
        select 1 from organizations o
        where replace(o.id::text, '-', '') = substring(c.relname from '_([0-9a-f]{32})$')
      )
      -- A spare has partitions and no organization on purpose, until it is claimed.
      and not exists (
        select 1 from spare_tenants s
        where replace(s.id::text, '-', '') = substring(c.relname from '_([0-9a-f]{32})$')
      )
    order by c.relname
  `);

  return found.rows.map((row) => row.child);
};

// **A referenced partition cannot be dropped, only detached first.** Postgres hangs the
// referencing parent's foreign key off every partition of the table it points at.
const isReferenced = async (database: Database, table: string): Promise<boolean> => {
  const found = await database.client.execute<{ referenced: boolean }>(sql`
    select exists (
      select 1 from pg_constraint
      where contype = 'f' and confrelid = ${table}::regclass
    ) as referenced
  `);

  return Boolean(found.rows[0]?.referenced);
};

export const setup = (): void => {};

// **Why a global teardown and not a line in each spec.** `database.ts` has exported
// `dropTenant` all along; twelve specs that found a tenant never called it.
export const teardown = async (): Promise<void> => {
  const database = new Database({ url: DATABASE_URL });
  let dropped = 0;

  try {
    // Reverse allowlist order, so a partition that references another goes first.
    // Names come from `pg_class`, already matched against the hex pattern above.
    for (const entry of [...PartitionedTable.TENANT_PARTITIONED].reverse()) {
      if (dropped >= BUDGET) break;

      const orphans = (await orphansOf(database, entry.name)).slice(0, BUDGET - dropped);
      if (orphans.length === 0) continue;

      if (await isReferenced(database, entry.name)) {
        for (const orphan of orphans) {
          await database.client.execute(
            sql.raw(`alter table ${entry.name} detach partition ${orphan}`),
          );
        }
      }

      for (let at = 0; at < orphans.length; at += BATCH) {
        const batch = orphans.slice(at, at + BATCH);
        await database.client.execute(sql.raw(`drop table ${batch.join(", ")}`));
        dropped += batch.length;
      }
    }

    if (dropped > 0) console.log(`[orphan-sweep] dropped ${dropped} partitions of deleted tenants`);

    // The other half of the same leak: a directory row outlives a tenant whenever a spec
    // deletes the organization rather than going through `PgTenantRepository.delete`.
    const swept = await database.client.execute(sql`
      delete from shard_assignments s
      where not exists (select 1 from organizations o where o.id::text = s.shard_key)
    `);

    if (swept.rowCount) console.log(`[orphan-sweep] swept ${swept.rowCount} directory rows`);

    // The same leak once more, and the newest: `24.1` dropped the key that took these,
    // and `outbox_event` has no tenant partition for the loop above to drop.
    const events = await database.client.execute(sql`
      delete from outbox_event e
      where not exists (select 1 from organizations o where o.id = e.organization_id)
    `);

    if (events.rowCount) console.log(`[orphan-sweep] swept ${events.rowCount} outbox rows`);
  } catch (error) {
    // Housekeeping must not fail a green run, but it must not fail quietly either:
    // the cost of it silently stopping is the lock ceiling coming back months later.
    console.warn(`[orphan-sweep] stopped after ${dropped} partitions:`, error);
  } finally {
    await database.close();
  }
};
