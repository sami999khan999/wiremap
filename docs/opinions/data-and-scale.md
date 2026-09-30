---
title: Data and scale
description: Which store owns which data, what is derived, what to build now, and the order every scaling move happens in.
---

# Data and scale

> [!NOTE]
> **Lite kit.** This page is the big kit's argument, kept whole because lite is the same design at
> an earlier point on it. Lite builds everything in §4 *Build now* — `organization_id` everywhere,
> partitioned append-only tables, the write path, indexed foreign keys, routing by key — and runs
> none of the stores §5 and §8 add: no Loki, no ClickHouse, no cold tier or retention pass, no
> pgBouncer, no replica, one shard node, and one Redis behind both `REDIS_*_URL` names. Where this
> page says a store *is* running, read it as the target; the digest in
> [`docs/ai/rules/data.md`](../ai/rules/data.md) states what holds today, and
> [`docs/scale/`](../scale/index.md) brings each store back.

Four streams of data with genuinely different properties, and one rule that decides where each one
lives. Then the work that has to happen before load arrives, and the work that waits until it does.

**The rule:**

> **Postgres owns anything a transaction depends on or a user reads immediately after writing.
> Everything else is a derived store behind a port.**

That sentence answers every future question of this kind without another conversation. The rest of
this page is what follows from it.

---

## 1. The four streams

| Stream | Written by | Store | Property |
|---|---|---|---|
| **Domain data** — tasks, goals, RBAC | use-cases | Postgres | Transactional; read after write |
| **Audit trail** — business facts | `ActivityLogger` | Postgres, partitioned | Must not be lost; in-transaction |
| **Domain events** — integration facts | `DomainEventPublisher` | Postgres outbox, partitioned | In-transaction, at-least-once, drained by the worker |
| **Diagnostics** — operator signal | `JsonLogger` | stdout → **Loki** | May be lost; 30-day retention |
| **Analytics** — aggregates over time | worker, from domain events | Postgres snapshots → ClickHouse | Derived; rebuildable |

The first three distinctions already exist in the codebase.
[Vocabulary](vocabulary.md) draws the line between an activity name and a log event code:
`task.reactivated` is a business fact a user may read, `queue.job.failed` is a diagnostic an
operator reads. **A business fact in stdout is lost on restart; a diagnostic in Postgres is a
retention bill.** The fourth stream is the one this page adds.

### Why audit is not a log

`ActivityLogger` writes inside the transaction ([12](../setup/12-application-package.md)). That is
what guarantees a state change and its audit row commit together. No external store can join that
transaction — so a task reactivation commits, the audit write is in flight, the process restarts,
and there is a state change with no record of who made it.

Under the audit requirements that is the highest-value class of record, and it is exactly the
failure a compliance review finds. **Audit is Postgres, at every scale on this page.** If audit
*search* gets slow, replicate to an analytical store for querying and keep Postgres as the record.

> [!IMPORTANT]
> **In-transaction is a claim about the code, not about intent.** `UnitOfWork` has to actually
> enrol the repositories that run inside it, or this guarantee is decorative — the audit row and
> the state change commit separately and the failure above is live. See
> [13](../setup/13-infrastructure-postgres.md).

### Why diagnostics are not a database

`JsonLogger` already emits structured JSON with a level and a correlation ID, and it is the one file
in the repository allowed to call `console` ([05](../setup/05-lint-and-format.md)). Ship stdout to a
log platform. Retention, full-text search, alerting, and level filtering become configuration rather
than code.

**Loki, and the choice is about ecosystem rather than engineering.** VictoriaLogs is technically
better — faster full-text search, no cardinality trap, lower disk usage. On pure merit it wins. But
"best overall" includes whether a new engineer can find an answer at 2am, whether the project exists
in five years, whether it integrates with what is already running, and whether there is a paid path
if self-hosting stops being worth it. Loki wins all four: Grafana Labs behind it, CNCF-default in the
Kubernetes ecosystem, years of answers already written down, and Grafana Cloud runs the identical
thing if you stop wanting to operate it — a config change, not a migration.

**Nothing self-hosted reads it back.** Loki is storage plus a `query_range` API, and the reader is
the super admin dashboard — the same surface that already knows what an organization is, which is the
one thing a generic log console cannot know. Grafana was in this stack and was removed for exactly
that reason: two consoles for one operator, and the query that matters — *these logs, for this
tenant, joined to that tenant's audit rows* — was the one it could not express.

**And the dashboard has a tier now.** `platform` is a third `PermissionScope`, held through a role
in the one organization marked `is_platform` and nothing else — no env list of admin emails, no
flag on `users`, no second permission system. A tenant owner's wildcard does not reach it, which is
what lets a global setting be edited from a screen that every tenant's owner can also open the URL
of. [platform-scope](../../packages/permissions/docs/reference/platform-scope.md) is the argument;
`/platform/status` is where it starts.

**The seam for that dashboard exists: `LogReader`, implemented by `LokiLogReader`.** It is `fetch`
against `query_range`, built only when `LOKI_URL` is set, and it changes nothing about the write path
— `JsonLogger` still goes to stdout and still has never heard of Loki. That asymmetry is the design:
the write path has no seam because it has no dependency.

Its `LogQuery` type offers the four labels and a substring filter over the line body, and nothing
else — so the cardinality rule below is enforced by the shape of the port rather than by convention.

Until the dashboard ships, reading logs is `docker compose logs`, curl, or that port. All three remain
the break-glass path afterwards: a log query that needs the app running is no use during the incident
where the app is down.

Deployment is Alloy tailing container stdout, storage on S3 or MinIO — both already running
([11](../setup/11-local-infrastructure.md)). Retention is a config line, literally
`retention_period: 720h`. **No code changes and no new environment variable;** `JsonLogger` writes
stdout and never learns the platform exists, which is what keeps it a
[Tier 0](dependencies.md) dependency and the swap a config change.

> [!WARNING]
> **Label cardinality is the one thing that decides whether Loki is fast or miserable.**
>
> ```
> ✓ labels:  app, env, level, event_code
> ✗ labels:  user_id, trace_id, task_id, organization_id
> ```
>
> A label creates one stream per distinct value, so `user_id` at 100k users means 100k streams and
> Loki falls over. This is the most common way Loki deployments fail and it is entirely avoidable.
>
> High-cardinality fields belong in the **log line**, queried after the selector has narrowed the
> streams:
>
> ```logql
> {app="web", level="error"} | json | trace_id="abc123"
> ```
>
> `Correlation` and `TraceId` from `@loadbearing/observability` are exactly the fields that must stay
> in the body. Promoting one to a label looks like an optimisation and is the opposite.

**`event_code` is a label, so `EVENT_CATALOG` is that label's cardinality budget** — plus exactly
one: `error.raised`, which is deliberately not a catalog entry because its level comes from
`ERROR_CATALOG[code].severity` rather than from a table. Every slice that adds a catalog fragment
spends the budget, which is a reason to keep event codes coarse — one code with a `queue` field beats
one code per queue.

**Revisit only if search latency becomes a real complaint during an actual incident** — that is the
only moment the difference is felt. The alternatives, if it does: **VictoriaLogs** (single Go binary,
fastest, youngest ecosystem), **OpenObserve** (best UI, S3-native), **SigNoz** (ClickHouse-backed —
considerably more attractive if ClickHouse is already being operated for analytics, on a *separate*
instance, since 30-day logs and multi-year analytics have incompatible resource profiles).
**Elasticsearch is not on that list**: several times the storage cost and constant tuning, justified
only when full-text search is the primary use case, which for diagnostics it is not.

### Why task status history is domain data, not analytics

It has three live consumers: reactivation logic reads it to decide, KPI computation aggregates it,
and users see it in a task detail view. It needs foreign keys to `tasks` and `users`, and it needs
read-your-own-writes — a user reactivates a task and immediately refreshes.

Postgres is the source. An analytical store gets a **copy** for aggregate questions.
*"What happened to this task"* is a Postgres query. *"Reactivation frequency across the org this
quarter"* is an analytics query.

---

## 2. Source of truth

Postgres is the source of truth for **domain data**. Not for everything — and the distinction is the
design, not a caveat.

### What Postgres owns

Anything a transaction depends on, or a user reads immediately after writing: tasks, goals, RBAC,
memberships, overrides, task status history, the audit trail, auth tables, user preferences. Every
one has the same property — if the write is lost or arrives late, something is wrong.

### What has a different source of truth

**Diagnostics live in the log platform**, never in Postgres. `JsonLogger` writes to stdout and does
not care if a line is lost ([05](../setup/05-lint-and-format.md)).

**Uploaded bytes live in S3.** Postgres holds the metadata row and the object key; the object store
holds the file. A genuine second source of truth, which is why deleting a resource is two operations
([12](../setup/12-application-package.md)).

**Embeddings live in pgvector today.** Physically inside Postgres, conceptually derived — they can be
regenerated from source documents, which is what makes the Qdrant swap safe
([14](../setup/14-vector-store.md)).

> [!NOTE]
> Three stores hold non-derivable things: Postgres, S3, and the log platform. They do not overlap —
> no fact lives in two of them — so there is never a question of which one is right. The failure
> "single source of truth" exists to prevent is *ambiguity*, not *plurality*.

### The test

> **If dropping a store loses information not recoverable from Postgres or S3, it has become a
> source of truth — whether you decided that or not.**

Run it whenever a store is added, and periodically after. The first time someone introduces
something because "it is just a cache," run it again.

### Redis

Three jobs, and they do not have the same answer.

| Use | Rebuilt from | If flushed |
|---|---|---|
| Capability cache | Postgres RBAC tables | A slow minute, then warm |
| Session cache | Better Auth's `sessions` table | Slower auth; nobody logged out |
| BullMQ queues | — | **Lost work** |

The first two are cache-aside and pass the test — `CapabilityCache` reads through to
`PgCapabilityRepository` on a miss ([16](../setup/16-auth-package.md)).

**BullMQ does not.** A queued job is not derived from anything; a lost job is work that never
happens. AOF persistence covers a crash, but a `FLUSHALL` is real data loss. Two consequences:

- **Separate Redis instances for cache and queues.** Different durability needs, and it means the
  cache can be flushed without touching pending work.
- **Make jobs reconstructible where it matters.** A nightly sweep that re-enqueues anything
  unprocessed turns a lost job into a delay rather than a gap. The idempotency rule for handlers is
  what makes that safe.

> [!WARNING]
> **The split has a consequence that is easy to get wrong.** The cache instance runs `allkeys-lru`,
> so anything on it can vanish under memory pressure. Session data reached through `CacheStore` is
> therefore a *cache in front of Postgres*, never the record — an evicted session must be a
> read-through, not a sign-out ([16](../setup/16-auth-package.md)).

> [!NOTE]
> **The sweep reconciles against Postgres, not against BullMQ.** Completed and failed job records
> age out in an hour and a day respectively ([15](../setup/15-infrastructure-package.md)), so a
> nightly sweep that reads job history finds nothing. The query is "which domain rows should have
> been processed and were not" — job history is not a durable work list.

### ClickHouse

Purely derived, and it has to stay that way — that is what makes it a performance decision rather
than a correctness one.

```
use-case → Postgres (authoritative) → domain event → worker consumer → ClickHouse
```

Drop the entire database and rebuild it by replaying the activity log.

**Two guards, because the way this fails is quiet:**

- **Nothing writes to ClickHouse except the event consumer.** No direct writes from use-cases, no
  manual backfills that are not replays.
- **A daily reconciliation job** comparing row counts per day against the activity log. The realistic
  failure is not an outage — it is a consumer that died on Tuesday, unnoticed until a quarterly
  report looks wrong.

**The way it stops being derived:** a KPI computed in a ClickHouse materialized view and stored
nowhere else. At that point it is authoritative, the rebuild story is gone, and nobody decided it.

---

## 3. Volume, by scale

Estimates for planning, not promises. What matters is which order of magnitude each row is in.

| | 500 employees | 25k employees | 100k DAU |
|---|---|---|---|
| Status changes / day | ~15k | ~750k | ~3M |
| Status changes / year | 5.5M | **270M** | **1B** |
| Activity rows / year | ~27M | **1.3B** | **5B** |
| Peak concurrent | ~100 | ~5k | ~15–20k |
| Peak writes / sec | <50 | 200–500 | **2–5k** |

Three thresholds fall out of that table:

- **Under 10M rows/year** — a single Postgres instance with good indexes. No decisions needed.
- **Around 250M rows/year** — partitioning is mandatory; analytics wants a column store.
- **Around 1B rows/year** — the single primary is at its ceiling; shard by tenant.

> [!NOTE]
> 2–5k writes/sec is reachable on one well-tuned Postgres primary, but with no headroom and with
> every schema migration becoming an event. That is the point at which sharding stops being an
> optimisation and becomes operational necessity.

---

## 4. Build now

Four things, none expensive, each of which is the difference between a future swap and a future
rewrite.

### 4.1 `organization_id` on every domain table

**The highest-value hour in the project.**

The RBAC model has an org scope but the schema assumed one organization
([16](../setup/16-auth-package.md)). Whichever way success arrives — many tenants on one deployment,
or one tenant growing large — the column is load-bearing. It is the sharding key.

Adding it now costs a column and a `WHERE` clause in the repository base class. Retrofitting it
across two dozen feature modules means touching every table, every query, every permission check,
and every test — while live, with customer data, under time pressure.

**The corollary: never write a query that cannot be scoped to a tenant.** A cross-tenant aggregate
in application code is a query that cannot be sharded. Those belong in the analytics store from
day one.

Three consequences that are easy to miss:

- **Every unique index gains the tenant column.** `roles_key_uq` on `(key)` alone means two tenants
  cannot both have an `owner` role.
- **`organization_id` is a branded `OrganizationId`**, like every other identifier
  ([10](../setup/10-contracts-package.md)). It is the one id where a swapped argument is a
  cross-tenant leak rather than an empty result set.
- **Spell it `organization`, not `organisation`.** The column name fixes the spelling; a codebase
  that uses both will resolve it inconsistently per file.
- **A routed table carries no foreign key to the catalog — and until `24.1` every tenant key
  cascaded.** The reason the rule inverted is not taste: **Postgres enforces no foreign key across
  two databases**, so the ten that crossed were impossible the day a shard became a separate
  server. Keeping them was not the cautious choice, it was the choice to abandon the split.
  - Nine were already doing nothing. The delete drops the tenant's partitions *before* it removes
    the `organizations` row, so six found nothing left to take, and the three naming `users` never
    fired — nothing deletes a user.
  - `outbox_event` was the one doing real work, because it has no tenant level and no partition to
    drop. `PurgeOrganizationUseCase` sweeps it explicitly.
  - **What is given up is the database saying so.** A leaked row used to be impossible; it is now
    rare, and the nightly `orphans` job is what notices. That is a guarantee moved, not dropped —
    and moving it is what the physical split costs.
  - Keys between siblings *on the catalog* stay, and stay `NO ACTION` rather than `RESTRICT`.
    **Keys into a tenant-partitioned table do not** — `PF.1` dropped `messages` and
    `conversation_members` into `conversations`. Attaching a partition validates every key the
    parent carries, and that validation takes `SHARE ROW EXCLUSIVE` on the table referenced, so each
    signup blocked every conversation insert on the node five times. The code already refused the
    write the key refused, and the nightly `orphans` job counts what leaks.

### 4.2 Partition the append-only tables

`activity_log` and `task_status_history`. Both grow forever, both are queried by recent time window.
Only the first is a shipped table — `task_status_history` belongs to the worked `task` feature and is
here as the second example, because one example makes a rule look like a special case.

**Both halves of that sentence are the test, and the second is the one people drop.** Append-only is
not the criterion; append-only *and growing with activity* is. A table that gains rows because
something happened is a candidate; a table that gains rows because time passed is not.

```sql
CREATE TABLE activity_log (
  id              uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  occurred_at     timestamptz NOT NULL,
  -- …
  PRIMARY KEY (id, organization_id, occurred_at)
) PARTITION BY LIST (organization_id);
```

**Tenant first, month underneath.** The parent splits by `organization_id`; each tenant's partition
splits again by `occurred_at`, one child per month. Every partition key has to be in the primary
key, which is why that key is three columns rather than two — and the same rule makes a reference to
a tenant-partitioned table a *composite* foreign key on `(id, organization_id)`.

The tenant level is not the same decision as the month level and does not have the same test. A
month level is for a table that grows with activity. A tenant level is for every table a tenant
owns, and what it buys is three things: a tenant's read prunes to one subtree, deleting a tenant is
a `drop table` rather than a cascade over years of rows, and a physical split becomes a data move
rather than a rewrite. The one exemption here is the outbox: the drain polls it once a second and
must not touch a partition per tenant to do it.

Three things this buys:

- Retiring old data is `DROP PARTITION` — instant, rather than a `DELETE` that bloats the table.
  And **retiring is not deleting**: every month is detached, streamed to S3 and verified before it
  is dropped ([cold storage](../../packages/infrastructure/docs/reference/cold-storage.md)).
- Index maintenance stays bounded, because each partition's index is small.
- A query carrying a *range* on the partition column reads only the months that range covers.

**The third one is narrower than it is usually written, and it was measured.** A "last 30 days"
floor prunes the retention tail and nothing else — a future month could legitimately hold rows, so
it stays in the plan. And a keyset cursor written as a row constructor, `(created_at, id) < (at, id)`,
does not prune at all: the planner does not decompose it, so a paged read widens to every partition
that exists. Only an equality or a closed range reaches one. See
[partitions](../../packages/infrastructure/docs/reference/partitions.md), where each query is
asserted at the shape it actually plans to.

**Which tables are partitioned is a list, not a convention, and so is their retention.**
`PartitionedTable.ALL` in `packages/application/src/primitive/partitioned-table.ts` is a frozen list
of `{ name, column, retentionMonths }` — the whole policy for a table in one entry, so the next
partitioned table is one line rather than one line plus a record somewhere else. `MaintenanceGateway`
takes the union derived from it rather than a `string`, and the monthly schedule loops it. Three
things fall out of writing it down. Postgres accepts no bind parameters in DDL, so the adapter
interpolates the table name and the closed union is the only boundary there is. A `retentionMonths`
of `null` says something else owns the table's lifecycle — `activity_log`'s archive drops a month
only after the upload is verified, and a calendar drop beside it would race that. And a table
partitioned in a migration but never added to the list quietly stops getting partitions the month
the migration's own runway ends, which is why `check-architecture` §21 reads the migration text and
asserts the list against it in both directions.

Create partitions ahead of time with a scheduled job, or use `pg_partman`.

> [!WARNING]
> **Set this up in the first migration.** Converting a large table to partitioned later is a rewrite
> with downtime. It is the one structural decision on this page that is genuinely painful to
> retrofit.

**Two mechanics that follow from Postgres, not from preference:**

- **A partitioned table's primary key must include the partition key**, so `activity_log` is keyed
  on `(id, occurred_at)` rather than `id` alone. Every unique index on the table inherits the same
  requirement. UUIDv7 and a time-range partition key are co-monotonic, so this costs nothing at
  insert time.
- **Drizzle cannot express `PARTITION BY`.** The schema declares an ordinary table and the generated
  DDL is hand-edited — which the workflow already accommodates, because migrations are generated,
  read, and committed rather than pushed ([13](../setup/13-infrastructure-postgres.md)).

**`session` is deliberately not on this list.** It looks like the third append-only table and is not
one: Better Auth updates it on refresh, deletes it on sign-out, and looks rows up by id — a
predicate carrying no partition key, so every lookup would scan every partition. It is bounded by
expiry instead, and a `DELETE … WHERE expires_at < now()` on the cleanup schedule is the right tool
([25](../setup/25-worker-app.md)).

**`partition_archive` is not on it either, and it is the case the rule reads as covering.** It is
genuinely append-only — one row per tenant per table per archived month, written by the retention
pass and by nothing else. It grows with **tenants × retired tables × the calendar**, which is a
handful of rows a month for a small deployment and is bounded by the cold-months policy above it.
Partitioning it would also defeat its purpose: it is the index a read of cold storage starts from,
and that read arrives holding a tenant and a table, not a time range.

The reason it looks like a candidate is that it sits beside `activity_log` and describes the same
data. It grows with the *calendar*, not with the audit trail — which is the distinction the sentence
above exists to make, and the reason to state it rather than leave it to be re-derived by whoever
notices the table next.

**Decide the retention policy at the same time, and say what "retention" means.** Here it means
**archive-then-drop**: 12–24 months of detail in Postgres, aggregates forever in the analytics
store, and every older partition in S3 under `cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz`
behind a row in `partition_archive`. No month is destroyed, `outbox_event` included. A month with
no rows writes no object, so an absent row means "nothing to restore" rather than "not archived".

**And it is a row, with the allowlist as the default.** The numbers live in `retention_policy`,
one row per store and table, and an absent row *is* `PartitionedTable`'s value — so an empty table
behaves exactly as the deploy before the table existed. A tenant may override its own in
`tenant_retention_policy`, which is only possible because a tenant's month is its own partition.
The row is the truth, and the bucket's lifecycle rules and the ClickHouse TTL are converged to it
nightly rather than written once and trusted.

### 4.3 The write path is built; the read seam is not

The projection is real: `AnalyticsProjector`, `ClickHouseAnalyticsProjector`, the projection
consumer and the nightly reconciliation all ship, and `CLICKHOUSE_URL` turns them on. **Nothing
reads the store back**, and that is deliberate rather than unfinished.

The kit used to ship an `AnalyticsReader` port with two methods — `goalRiskScores` and
`reliabilityTrend` — two Postgres rollup tables to answer them, a ClickHouse implementation, and an
`ANALYTICS_DRIVER` flag to choose. Nothing called any of it. No consumer meant no evidence about
the shape, so what shipped was a guess at two queries and two table layouts, kept in step by hand
across two adapters. It was deleted in favour of building it when a dashboard asks.

This is [simplicity](simplicity.md) applied to its own example: *"the seam is implemented"* and
*"the store is running"* are two decisions, and only the second costs anything to be wrong about.
A read seam whose future swap touches one adapter has earned nothing until something reads it.

**When a dashboard does need one, this is the shape**, and the one part worth deciding in advance
is the signature:

```ts
public abstract goalRiskScores(
  goalIds: readonly GoalId[],
): Promise<readonly RiskScore[]>;
```

**`goalIds` is a parameter, not an option.** The permission filter runs on the input set before the
query, resolved by `capabilities.goalsWith()` — identical in shape and reasoning to
`VectorStore.search()` ([14](../setup/14-vector-store.md)), which is the seam that *does* ship and
is worth reading first. An analytics store does not know the `CapabilitySet`, so the scope has to
arrive already resolved. Putting it in the signature means it cannot be forgotten.

**It belongs in `port/` rather than in a slice** because it is one cross-cutting read seam over many
subjects, not one port per subject — the same reason `VectorStore` is there and `TaskRepository` is
not ([12](../setup/12-application-package.md)).

**Every method is async from the first day**, even where the Postgres implementation could answer
synchronously. A ClickHouse implementation cannot be synchronous, so a synchronous seam would make
the swap a breaking change at every call site.

**Write through domain events, never from use-cases:**

```
use-case → Postgres (source of truth) → domain event → worker consumer → analytics store
```

Postgres stays authoritative. The analytics store is a derived read model that can be dropped and
rebuilt by replaying the activity log. **Protect that property.** The moment it is the only copy of
something, a rebuild becomes data loss.

#### The two deletion rules that follow

**Cascade from the tenant, `NO ACTION` between siblings.** `memberships.role_id` and
`invitations.role_id` must stop a role that is in use from being deleted — but as `NO ACTION`, not
`RESTRICT`. The difference is when the check runs: `NO ACTION` defers to the end of the statement,
so `DELETE FROM organizations` may cascade the roles and the memberships together; `RESTRICT` is
checked the moment the role row goes and would reject its own cascade.

**The audit trail is the exception, deliberately.** `activity_log.actor_id` is not a foreign key at
all: an audit row outlives the actor it names, and a cascade would erase the trail of a deleted
account exactly when it matters. Retention removes those rows, not referential integrity.

### 4.4 Index every foreign key and every filtered column

Postgres does not auto-index foreign keys, which surprises people.
`memberships_user_idx` and `goal_members_user_idx` are already called out as non-optional
([13](../setup/13-infrastructure-postgres.md)) because `CapabilityRepository.resolveFor()` runs on essentially
every request. The same reasoning applies to every FK added after.

**The index has to *lead* with the foreign key column, and that is a second requirement rather than
a restatement of the first.** `goal_members_user_idx` is on `(organization_id, user_id)`, which is
right for the resolver and useless to the cascade: deleting a user is not a tenant-scoped operation,
so Postgres cannot use a tenant-leading index for it and takes the table scan instead, holding a
lock for the length of it. Four tables here were in exactly that state — the column present in a
composite, the cascade unindexed — which is why this is now assertion 18 in `check:architecture`
([26](../setup/26-hygiene-and-ci.md)) rather than a paragraph.

**The answer is a second index, not a reordering of the first.** Reordering trades a hot read for a
rare write, and the hot read is capability resolution on every request. The cascade-only indexes are
named `<table>_<subject>_fk_idx` so that the next person to see two indexes over overlapping columns
can tell which one exists for a query and which one exists for a delete.

**Add query-count assertions to integration tests now.** N+1 queries hit at 50 users, not 5,000, and
no database choice fixes them. It is the cheapest performance guardrail that exists.

### 4.5 Route by key from the first line

Every query already resolves a database through a `DatabaseCluster` and a key, and every table is
declared `catalog`, `local` or `routed`. There is one physical Postgres behind it, and there is
meant to be for a long time.

That is a seam built before the thing it abstracts, which [Simplicity](simplicity.md) normally
calls ceremony — and it names the exception this is:

> an abstraction earns its place early when the swap is certain and the retrofit is **spread**
> rather than local.

Both halves hold here. A single primary ends at some volume, so the swap is certain rather than
speculative. And retrofitting it is spread across every repository, every use-case that opens a
transaction, every cross-tenant loop in the worker, and every script that writes DDL — 183 call
sites that read `this.db`, thirty-three repositories that would each need a placement decided
under deadline, and five sweeps that would each have to be found. Compare #6 in the table below:
adopting a dedicated vector store touches one adapter, so the seam there earns nothing the day
before it is needed.

**What it bought, concretely.** `BaseRepository.db` throws when a catalog repository is used
inside a routed transaction — on one node, today, in every environment. That is not a
future-proofing gesture; it is the difference between finding those call sites in a test run and
finding them in production the week of a migration. Two were found this way, and both are fixed:
`PgNotificationRecipientReader.conversationMembers` joined routed to catalog in one statement, and
`PgPartitionArchiveGateway` wrote a catalog index row from a routed transaction.

**What it did not buy, deliberately.** No placement policy, no second node in the default stack,
no rebalancer. *"The seam is implemented"* and *"the store is running"* are two decisions, and
only the second costs anything to be wrong about. See
[sharding](../../packages/infrastructure/docs/reference/sharding.md).

---

## 5. Build when it hurts

Each of these is days, not months, because the seam already exists. **Do not build them in advance.**

| # | Move | Trigger | Cost |
|---|---|---|---|
| 1 | Add an index, rewrite a query | A single slow query | Hours |
| 2 | KPI snapshot tables | Dashboard over 1s on a warm cache | A day |
| 3 | Read replica for dashboards | Reads competing with writes | A day; one adapter change |
| 4 | pgBouncer, transaction mode | Past ~100 connections | **Built** — always on, since `plans/archive/DB-SCALING-PLAN.md` Phase 1 |
| 5 | ClickHouse reads, behind a new `AnalyticsReader` | Snapshots stop covering ad-hoc queries | **One env var, then a day** |
| 6 | A dedicated vector DB behind `VectorStore` | pgvector recall or latency degrades | Days |
| 7a | The routing seam — cluster, directory, placements | — | **Built**, at one node ([4.5](#45-route-by-key-from-the-first-line)) |
| 7b | The physical split: a second Postgres, tenants moved | Writes past a single primary | Weeks → **days**; `plans/archive/PLAN.md` Phase 24 |
| 8 | Broker-backed event bus | In-process dispatch saturates | Days — needs §6 |

Most products never get past #2. Each step is ordered by cost, so exhaust the cheap ones first —
"Postgres does not scale" is usually said by someone who skipped #1 and #4.

**#4 is the one exception to "do not build in advance", and it was taken deliberately.** Retrofitting
a pooler is not the hours this table says once an application has been written against a direct
connection: `statement_timeout` moves from a startup parameter to a role default, DDL splits onto a
second URL, and every session-level `SET` in the codebase becomes a bug. Doing it at zero
connections costs one compose service and one migration; doing it at a hundred costs an audit.
The trigger for the *next* move is now observable rather than guessed at —
`database.pool.saturated` on this side of the pooler, `SHOW POOLS` on the other. See
[`docs/infra/reference/pgbouncer.md`](../infra/reference/pgbouncer.md).

### On ClickHouse specifically

**At 500 employees it is premature.** Half a million rows a year is a Postgres table with a good
index, and snapshot tables cover the KPI rollups the spec already calls for.

**At 25k employees it is planned-for.** 1.3B activity rows makes org-wide trending a query Postgres
answers in tens of seconds. Snapshots help but only answer questions precomputed in advance —
predictive analytics and ad-hoc KPI exploration are exactly what they cannot cover.

**At 100k DAU it is required.**

Because the write path is a replay of `activity_log` from step 4.3, adopting it changes where rows
land and nothing else. **The pipeline is built; filling the store is a config change.**

**And what reaches it is a row, not a constant.** `projection_policy` holds one entry per activity
action — whether it is projected at all, and optionally its own TTL — with an absent row meaning
"projected, for the default window". That matters before the store is running rather than after:
the highest-volume actions are usually the least interesting ones, and the decision to stop
carrying them is cheap to make on day one and expensive on the day the bill arrives. Excluding one
later is not retroactive: rows already there stay, new ones stop, and past the audit table's own
window the gap can only be filled from cold storage.

Move #5 says "one env var, then a day" because `ClickHouseAnalyticsProjector`, the projection
consumer and the nightly reconciliation are written, and the container is in the compose file
behind a profile:

1. `pnpm infra:up:analytics` — starts the container. Nothing writes to it.
2. `CLICKHOUSE_URL=…` — the projection starts filling it and the reconciliation starts reporting.
3. Write the reader the dashboard actually needs, against a store that has been filling and
   reconciling for days.

**Step 2 without step 3 is the state to sit in**, and it is why filling the store is separated from
reading it: a switch that moved reads the moment the pipeline started would cut a dashboard over to
a store that is still backfilling. That gap used to be spelled `ANALYTICS_DRIVER`. It is now the
absence of a reader, which cannot be flipped by accident.

What is still a week, if you want it, is what the store is *for*: the rollup job at move #2, which
does not exist in either store, and the queries a real dashboard asks. The infrastructure is not the
part that was ever going to take a week.

---

## 6. What breaks before the database does

Three application patterns fail at every scale on this page, and no store choice fixes any of them.

### Capability resolution

At 10k requests/sec that is 10k `CapabilitySet` lookups per second, and a 60-second TTL means a
cache-miss storm every minute — each miss running the three-query join
([16](../setup/16-auth-package.md)).

Two fixes, and at that scale both are needed:

- **Signed capability data in the session cookie**, short TTL. Most requests then resolve permissions
  with a signature check and zero network calls.
- **An in-process LRU in front of Redis.** Twenty app instances each see a working set of maybe a
  thousand users; a 5,000-entry LRU at a 10-second TTL absorbs most reads before Redis sees them.

**The revocation window becomes the shortest TTL in that chain.** Sixty seconds and no longer — the
TTL is a backstop for an invalidation you forgot, not the primary mechanism. Every tier is bound by
that number, the cookie cache included.

**The desktop shell has no cookie**, so a bearer-token client pays full resolution and needs the LRU
to carry it ([30](../setup/30-desktop-app.md)). A long-lived desktop token and a 60-second
revocation window need reconciling explicitly rather than by accident.

### Digest fan-out

A daily digest is permission-filtered per recipient. Done naively at 100k recipients that is 100k
capability resolutions and 100k query sets, and the job runs for hours.

**Group recipients by capability shape, compute once per group, personalise at render.** Locale and
copy stay per-recipient — those are cheap. It is the capability resolution and the query set that
must be shared.

`SendNotificationDigestUseCase`
([`packages/application/src/notification/send-notification-digest.use-case.ts`](../../packages/application/src/notification/send-notification-digest.use-case.ts))
answers the half that had to be right on day one: recipients arrive as keyset pages of 200, each
page costs one address-and-locale query rather than one per person, and the mail leaves through
`MailPublisher` so a slow SMTP server cannot stall the scan. It does **not** group by capability
shape yet, because it does not resolve a capability per recipient at all — the digest reads a
recipient's own rows, which are already the filtered set the subscriber wrote. The grouping above
becomes necessary the first time a digest asks a question of the domain instead of the inbox.

### Aggregate views

A capacity view aggregating every employee's tasks across every goal is a live join over everything.
Past a few thousand employees it must be a materialized view on a refresh schedule.

### Notification write amplification

One task change notifying five people is 5× the write rate on the notification table. That table
needs its own partitioning and an aggressive retention policy, or it becomes the largest table in
the database by an order of magnitude.

Both were in the first migration, which is the only time either is cheap.
[`packages/infrastructure/src/pg/schema/notification.schema.ts`](../../packages/infrastructure/src/pg/schema/notification.schema.ts)
is `PARTITION BY RANGE (created_at)` with `(id, created_at)` as its key, and `notifications` is a
member of the frozen `PartitionedTable` allowlist that `MaintenanceConsumer` walks — so the monthly
partition is created ahead of need and, after twelve months, archived to S3 and dropped by the same
loop that maintains the audit trail and the outbox. Retention is a number in one table there, not a
job someone has to remember to write.

### Message fan-out

A message in a conversation of N members is one row and N realtime publishes — the
`MessagingRealtimeSubscriber` loop that keeps every member's inbox ordered. That is the
amplification to watch, and it is bounded deliberately in three places.
[`packages/application/docs/reference/messaging.md`](../../packages/application/docs/reference/messaging.md)
carries the whole argument; the shape is: the **body** rides the conversation channel and is
published once, the **user** channels get a compact "something changed" frame and only for the
three events that reorder a list, and the notification policy stops at direct conversations
entirely — a busy channel producing a bell item per member per message is this section's failure
with a table attached.

Unread is the other half, and it is computed rather than counted: `last_read_at` is the only
state and the count is a capped `LATERAL` per row of a page, so there is no per-member write per
message and nothing to drift. The swap at 100k is that method behind a Redis counter, with
`last_read_at` still the record.

> [!TIP]
> Load-test these three paths at 10× expected volume **before** launch, with realistic data
> distribution. Everything else can be fixed reactively; these fail in ways that take a week to
> unpick.

---

## 7. What holds unchanged

Worth naming, because it is most of the system. At every scale on this page:

- **`packages/application`** — sharding is a repository and DI-root concern; use-cases never learn
  about it. They declare a `UnitOfWork` and call `findBy…`; which pool answers is decided by the
  placement on the repository and the key the container put in scope before the call.
- **`packages/permissions`** — pure computation, no I/O, identical answer in every runtime.
- **`packages/contracts`** — unchanged apart from one more branded identifier.
- **The web tier** — stateless by construction: no request state in `Container`, no module-scope
  `QueryClient`, sessions in Postgres and Redis ([17](../setup/17-composition-container.md)).
  Scaling is `replicas: 40`.
- **Workers** — BullMQ repeatable jobs dedupe across replicas, so consumers scale on queue depth
  independently of the web tier.
- **Event handlers** — moving from in-process dispatch to a broker changes the dispatcher, not the
  subscribers.

That last one is now built, and it was built broker-shaped: `DomainEventPublisher.publish` is async
and returns nothing, handlers are idempotent on a stable event id, there are no ordering
assumptions, and no handler exception reaches the publisher. Each of those is something a Kafka or
Redis Streams implementation cannot give back later, and a handler that started depending on
synchronous in-process semantics is the one thing that would make the swap expensive.

**It is an outbox, not a bus, and the distinction is the reason it exists.** The event and the state
change that caused it must commit or fail together. Publishing to a broker inside a transaction
cannot be rolled back; publishing after it commits loses the event on a crash in between. A row
written in the same transaction and drained by the worker is the only shape with neither hole — and
`BaseRepository` already joins the ambient transaction, so it is one line at the call site.

**Shape was not a reason to declare the port early**, and this is the second attempt. An `EventBus`
port was declared here, faked in `TestContainer`, and bound nowhere, which meant a use-case that
published would have published into nothing in production while reading as correct. It was deleted.
What landed instead landed whole: a port, an adapter, a `Container` line, one real publisher and one
real subscriber, in one change. The name went with it — there is no `Bus` in this design, and
`classes.md` no longer lists one.

**The in-process dispatch this section warns about is structurally impossible here.**
`SubscriberRegistry` is consulted only by `OutboxConsumer`, which runs in the worker. A subscriber
invoked from the web tier would be exactly the coupling that makes a broker swap expensive, and
there is nowhere in `apps/web` that can reach one.

---

## 8. Target topology, by scale

### Up to ~5k employees

```
Postgres (primary)      catalog + node 0, one machine — domain · audit · history
  └─ shard_assignments    the directory: one row per tenant, naming node 0
Redis (cache)           capability cache · session cache · shard map  ← allkeys-lru
Redis (queue)           BullMQ                                ← noeviction, AOF
S3 / MinIO              uploads · Loki chunks
stdout → Alloy → Loki   diagnostics, 30 days
```

Five stores, and all of them are in `infra/docker-compose.yml` from
[11](../setup/11-local-infrastructure.md) — including Loki, which stores into the MinIO that was
already there. Partitioning and `organization_id` are in place from day one, unused.

**ClickHouse is in that compose file too, behind an opt-in profile, and stopped.** The seam exists,
the container exists, and nothing writes to it. That is the intended state until §5's trigger fires —
a running analytics store with no consumer looks like a decision somebody made. `postgres-shard-1`
is there on the same terms, behind the `sharded` profile, for rehearsing the split rather than
running one.

**One machine is catalog and node 0 at once, and that is not a temporary simplification.** The
catalog is node 0 at every scale below — it holds `users`, `organizations`, RBAC and the
directory, and a routed node holds what a tenant produces. At this size they are the same
Postgres, and nothing in the code knows that.

### ~25k employees

```
Postgres (primary + read replica)   still catalog + node 0 — domain · audit · history
  ├─ partitioned monthly
  ├─ shard_assignments, every row still naming node 0
  └─ pgBouncer, transaction mode
Redis (cache / queue, separate)     capability cache · sessions | BullMQ
ClickHouse                          analytics aggregates, fed by domain events
pgvector or Qdrant                  embeddings, behind VectorStore
S3                                  uploads · Loki chunks
stdout → Alloy → Loki               diagnostics, 30-day retention
```

### ~100k DAU

```
Postgres catalog                    users · organizations · RBAC · shard_assignments
  └─ pgBouncer, read replica
Postgres node 1..N                  routed: everything a tenant produces
  ├─ read replica per node
  ├─ pgBouncer per node
  └─ activity_log and outbox_event on every one of them
Redis Cluster                       already split by concern before clustering
ClickHouse                          analytics · audit search
Qdrant                              embeddings
Kafka or Redis Streams              behind `DomainEventPublisher`, replacing the Postgres outbox
S3                                  uploads · Loki chunks
stdout → Alloy → Loki               diagnostics
```

> [!IMPORTANT]
> **The architecture holds at 100k DAU. The default deployment does not.** Every move on that path is
> an adapter swap or an infrastructure change, and no business logic is touched — which is what the
> ports were for. But running sharded Postgres, ClickHouse, Redis Cluster and forty app instances is
> a platform team, not a side effect of good architecture. At 100k DAU that team exists. The
> architecture's job is to make sure it spends its time on infrastructure rather than on a rewrite.

---

## 9. The decision, in one table

| Question | Answer |
|---|---|
| Tasks, goals, RBAC | Postgres |
| Task status history | Postgres, partitioned monthly |
| Audit trail | Postgres, partitioned monthly, **in-transaction** |
| Domain events | Postgres outbox, partitioned monthly, **in-transaction**, drained into BullMQ |
| Auth sessions | Postgres + Redis cache |
| Which database answers | `shard_assignments` on the catalog, one row per tenant, read through `ShardResolver` |
| Vectors | pgvector, behind `VectorStore` — `VECTOR_DRIVER` |
| Analytics aggregates | Postgres snapshots → ClickHouse, written by `AnalyticsProjector` — `CLICKHOUSE_URL`. No reader yet; see §4.3 |
| System logs | stdout → **Loki**, 30-day retention, low-cardinality labels only; read back through `LogReader` |
| Uploads | S3, presigned URLs, short TTL |

**Derived stores — rebuildable, never authoritative:**

| Store | Rebuilt from | Guard |
|---|---|---|
| Redis — capability and session cache | Postgres | Read-through on miss |
| Redis — BullMQ | **Nothing** | Separate instance; AOF; re-enqueue sweep |
| ClickHouse | Activity log replay | `AnalyticsProjector` is the only writer; nightly reconciliation |
| pgvector or a dedicated store | Source documents | Re-embed |

**Do this week:** `organization_id` everywhere · partition `activity_log` and `task_status_history` ·
index every FK · query-count assertions in integration tests · separate the Redis cache instance
from the queue instance.

**Do not do this week:** *starting* ClickHouse, a dedicated vector database, a **second Postgres**,
a broker — nor an `AnalyticsReader` before a dashboard asks one a question. Note which word moved:
the routing seam is built ([4.5](#45-route-by-key-from-the-first-line)) and running a node to route
to is the part that stays on this list. Each is a swap behind a seam that
already exists or is a day's work when it is needed, and building any of them before a real query is
slow means building the wrong schema for a load pattern nobody has measured.

> [!NOTE]
> **"The seam is implemented" and "the store is running" are two different decisions, and only the
> second one costs anything to be wrong about.** The ClickHouse adapters are written and covered by
> the smoke check; the container is stopped and `CLICKHOUSE_URL` is unset. That is not a
> contradiction of the line above — writing an adapter costs a day once, while running a store you do
> not need costs an operator forever, and a store that is running with nothing writing to it looks
> like a decision somebody made.
>
> The same split applies to `VECTOR_DRIVER`, which has exactly one legal value and exists anyway: a
> seam with one implementation is untested by construction, and a discriminated `driver` on
> `ContainerConfig` is what turns "swap the implementation" from a claim into a compiler-checked edit.
