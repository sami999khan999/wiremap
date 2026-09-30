-- Retention per tenant, which decision D29 is what makes expressible: a tenant's month
-- is its own partition, so "keep this customer six months" is a drop rather than a
-- `DELETE` out of a partition everybody shares.
--
-- It **leads with the tenant**, so unlike `retention_policy` it needs no §9 exemption.
-- And it carries no foreign key to `organizations`, for the reason `partition_archive`
-- gives: the tenant delete path removes these rows in a stated order rather than
-- letting a cascade do it in whatever order Postgres picks.
CREATE TABLE "tenant_retention_policy" (
	"organization_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"hot_months" integer NOT NULL,
	"cold_months" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_retention_policy_organization_id_table_name_pk" PRIMARY KEY("organization_id","table_name"),
	CONSTRAINT "tenant_retention_policy_hot_months_ck" CHECK ("tenant_retention_policy"."hot_months" >= 1),
	CONSTRAINT "tenant_retention_policy_cold_months_ck" CHECK ("tenant_retention_policy"."cold_months" is null or "tenant_retention_policy"."cold_months" >= 0)
);
