-- Derived, and rebuildable by replaying the activity log. Nothing here is a
-- source of truth, which is what keeps the swap a performance decision.
--
-- Unqualified now. `clickhouse-migrate.ts` sends every statement with `database=` on
-- the query string, so the session default is already CLICKHOUSE_DATABASE — and a
-- hard-coded `ratchet.` here would put the table in the wrong place on a deployment
-- that named its database anything else.

-- ── the projected audit trail ────────────────────────────────────────────────
--
-- One row per `activity_log` row, written only by `ClickHouseAnalyticsProjector`
-- and by nothing else. That restriction is the first of the two guards: the moment
-- a use-case writes here directly, or a hand-run backfill invents a row, the store
-- stops being rebuildable and has quietly become a source of truth.
--
-- `ReplacingMergeTree`, not `MergeTree`. BullMQ redelivers, so the projection has
-- to be idempotent, and the sorting key ends in `id` so a redelivered batch
-- collapses onto the rows it already wrote rather than doubling them.
CREATE TABLE IF NOT EXISTS activity_events
(
  -- The `activity_log` primary key, carried across. It is what makes the insert
  -- idempotent and what the projection checkpoint reads back.
  id              UUID,
  organization_id UUID,
  occurred_at     DateTime64(3),
  actor_id        UUID,
  action          LowCardinality(String),
  -- Lifted out of the payload by the replay reader. A column rather than a JSON
  -- extraction because queries order and group on it, and JSON extraction inside
  -- an ORDER BY is what makes a column store slow.
  subject_id      Nullable(UUID),
  -- The rest of the bag, as text. Typing it would make every new payload field a
  -- schema migration on a table holding years of rows, for data nothing groups by.
  payload         String
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(occurred_at)
-- Tenant first, because every analytics query narrows by it — the same reasoning
-- that puts `organization_id` at the front of the Postgres indexes. `id` last, so
-- the whole tuple is the dedup key.
ORDER BY (organization_id, occurred_at, id)
-- Longer than the Postgres retention window on purpose. Postgres keeps thirteen
-- months and archives the rest to S3; this is where the multi-year questions are
-- answered from, which is the entire reason for its existence.
--
-- **Months, not years, and the unit is load-bearing.** ClickHouse stores the clause as
-- `toIntervalMonth(60)` / `toIntervalYear(5)` and the retention policy is written in
-- months, so `INTERVAL 5 YEAR` here would differ from what `RetentionRules` composes —
-- and the daily reconcile would rewrite every part of this table, once, for nothing.
TTL toDateTime(occurred_at) + INTERVAL 60 MONTH;
