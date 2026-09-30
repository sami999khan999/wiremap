-- Retention stops being a deploy. One row per store per table, and **an absent row is
-- the code default** — `PartitionedTable.ALL` for postgres, five years for ClickHouse —
-- so an empty table behaves exactly as the deploy before it did and the first edit is
-- the first change (decision D33).
--
-- Global on purpose, and a `TENANT_EXEMPT` line in check-architecture §9 says so: a
-- partition is the unit of archival and of dropping and it spans every tenant, so a
-- per-tenant row here would describe something the storage engine cannot do. Per-tenant
-- retention is `tenant_retention_policy`, which works only because a tenant's month is
-- its own partition.
--
-- `store` and `cold_mode` are `text` with drizzle-side enums rather than Postgres ones,
-- the same choice `roles.scope` makes: widening either is then a type change with no DDL.
CREATE TABLE "retention_policy" (
	"store" text NOT NULL,
	"table_name" text NOT NULL,
	"hot_months" integer NOT NULL,
	"cold_months" integer,
	"cold_mode" text DEFAULT 'archive' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policy_store_table_name_pk" PRIMARY KEY("store","table_name"),
	CONSTRAINT "retention_policy_hot_months_ck" CHECK ("retention_policy"."hot_months" >= 1),
	CONSTRAINT "retention_policy_cold_months_ck" CHECK ("retention_policy"."cold_months" is null or "retention_policy"."cold_months" >= 0)
);
