---
title: Lite kit plan — a smaller sibling of the loadbearing kit that can grow back into it
updated: 2026-09-30
owner: sami
schema: plan/v1
source: loadbearing_tanstack_start_kit at 3fafa78c (dev), 2026-09-30; two read-only surveys (architecture map, docs system + features) and two rounds of feature questions answered by the owner
---

# Lite kit plan

> **Where this file lives once executed.** The first step, `LT0.2`, copies it to
> `E:\draft\starter_kit\loadbearing_tanstack_start_lite\docs\plans\LITE-KIT-PLAN.md`. The new kit keeps
> its plans in `docs/plans/` (owner's choice), not the big kit's root `plans/`.

> **How to use this file**
> 1. The ID prefix is `LT`, which no other plan uses yet. Items are `LT<phase>.<n>`.
> 2. Checkboxes: `[ ]` todo, `[~]` in progress, `[!]` blocked, `[x]` done, `[-]` dropped. Add `done: YYYY-MM-DD` when closing an item.
> 3. Phases run in order. Each item names the doc it must update.
> 4. Commit once per layer, in the order `add-slice.md` gives. Conventional commits with a scope. **No AI or co-author trailers**; this repo rule outranks any tool default.

---

## Context

`loadbearing_tanstack_start_kit` ("the big kit") is built for scale: 3 apps, 16 packages, sharding, partitions,
a replica, pgbouncer, ClickHouse, Loki, a cold tier, messaging, widgets, and 53 migrations. A smaller project
does not need that weight on day one. It does need the same code, folders and rules, so it can later become
the big kit without a rewrite.

**What "lite" means here.** The owner chose to keep nearly every product feature. Lite is therefore mostly
**the big kit minus its data-scale and ops layer**, plus a few product slices that were not selected.

| | Big kit | Lite kit |
|---|---|---|
| Apps | web, worker, realtime | web, worker, realtime (same) |
| Packages | 16, scope `@loadbearing/*` | the same 16, same names and scope |
| Auth | email/password, Google, 2FA, API keys, orgs, invitations | same |
| Access | RBAC, flags, entitlements, per-user overrides, widgets and zones | RBAC, flags, entitlements. **No widgets or zones.** |
| Platform admin | accounts, analytics, entitlements, flags, retention, shards, status, storage | accounts, entitlements, flags, status |
| Docs | DB-backed; audiences `public`, `members`, `granted` | same, **plus `owner`** (private to the author) |
| AI search | pgvector + OpenAI only | pgvector with **`none`, `openai` or `gemini`**. With `none` it falls back to lexical search. |
| Realtime + notifications | yes | yes |
| Messaging | yes | **cut** |
| i18n | en, bn | en, bn |
| Uploads | S3/MinIO + cold tier | S3/MinIO, **no cold tier** |
| Postgres | primary + pgbouncer + replica + shards + per-tenant partitions | **one Postgres node**, same partitioned tables and shard placements, no pgbouncer or replica |
| Redis | two instances (cache, queue) | **one instance**; both env vars point at it |
| Analytics / logs | ClickHouse, Loki + Alloy | JSON logs to stdout only |

### Decisions recorded up front (do not re-litigate)

1. **Copy, then prune.** The kit starts from `git archive` of the big kit at `3fafa78c` and has code removed. Nothing is rewritten from scratch, so every kept file is the big kit's file. The sha goes in `UPSTREAM.md`.
2. **Same npm scope, `@loadbearing/*`, and the same package names.** Porting a slice back is a file copy.
3. **Same names on every seam:** ports, table names, permission keys, error codes, env var names and routes. A cut feature leaves no renamed stub behind; it is simply absent.
4. **Every domain table keeps `organization_id`**, and every unique index leads with it. The rules say adding that later is the costly rewrite, so it stays.
5. **Stores are removed; seams are kept.** Tables stay `PARTITION BY LIST (organization_id)`, and the activity-growing ones also `RANGE`. Repositories keep their `catalog`/`local`/`routed` placement, and `DatabaseCluster` runs one node. `docs/ai/rules/data.md` requires this, because retrofitting either is a rewrite with downtime. Migrations are squashed into one lite baseline, `0000_lite_baseline.sql`, which keeps the partition DDL. *(Changed 2026-09-30: this decision first said plain tables.)*
6. **One Redis, running `maxmemory-policy noeviction`.** BullMQ must never lose a job to eviction, so every cache key needs a TTL. `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` both stay in `env.ts` and point at the same instance. Splitting them later is an `.env` change.
7. **`DATABASE_URL` points straight at Postgres.** `DATABASE_DIRECT_URL` stays as an alias, so adding pgbouncer later is an `.env` plus compose change.
8. **Ports use a `2` prefix** (Postgres on 25432, web on 23000, and so on) and the compose project is renamed, so both kits can run on one machine.
9. **Features new in lite are back-ported:** the Gemini provider, the lexical fallback and the `owner` audience. Each one gets a box in the big kit's `plans/BACKLOG.md`, so the two kits stay a prefix of each other.
10. **A fresh `git init`**, not a fork of the big kit's history. Scale-up diffs are taken against the sha in `UPSTREAM.md`.

### What exists and is reused (verified at `3fafa78c`)

- **Slice run book:** `docs/ai/skills/add-slice.md`. **Docs run book:** `docs/ai/skills/add-docs.md`. **All 14 rules:** `docs/ai/rules/*.md`, loaded by `CLAUDE.md` and `AGENTS.md`.
- **Embedding seam:** the `EmbeddingProvider` port (`packages/application/src/port/embedding.provider.ts`) and `VectorStore` (`vector.store.ts`). There is one adapter, `packages/infrastructure/src/openai/openai-embedding.provider.ts`, wired at `packages/composition/src/container/container.ts:792`. The vector column is `vector(1536)` (`pg/schema/vector.schema.ts:37`). The use-case is `packages/application/src/ai/search-documents.use-case.ts`.
- **Docs audiences:** `z.enum(["members","public","granted"])` in `packages/contracts/src/doc/doc-space.contract.ts:7`. Rules are in `packages/application/src/doc/doc-access.ts` and `doc.rules.ts`. Lexical search is `doc-search.ts`, over the `doc_sections` tsvector (`pg/schema/doc.schema.ts:152`).
- **Gates:** `tooling/scripts/check-architecture.mjs` (31 checks), `check-contrast.mjs`, `comment-density.mjs` and `boot-smoke.mjs`. CI is `.github/workflows/ci.yml`.
- **Plan format:** `plans/archive/ACCESS-AND-VISIBILITY-PLAN.md`.

---

## The phases

### Vocabulary fixed up front

| Thing | Name |
|---|---|
| Folder | `E:\draft\starter_kit\loadbearing_tanstack_start_lite` |
| Root package name | `loadbearing-lite` (workspace packages stay `@loadbearing/*`) |
| Compose project / container prefix | `lite` |
| Upstream record | `UPSTREAM.md`: big-kit sha, date, and the list of cut features |
| Scale-up guide | `docs/scale/index.md` plus one page per cut feature |
| Plans | `docs/plans/index.md`, `docs/plans/LITE-KIT-PLAN.md`, `docs/plans/BACKLOG.md` |
| Embedding switch | `EMBEDDING_PROVIDER=none\|openai\|gemini`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS=1536` |
| Gemini adapter | `packages/infrastructure/src/gemini/gemini-embedding.provider.ts`, class `GeminiEmbeddingProvider` |
| Private docs audience | `owner` |

---

### Phase 0 — Bootstrap the copy

**Goal.** Put a tracked copy of the big kit in the new folder, with nothing removed yet, that builds and passes every gate.

- [x] `LT0.1` **Export** with `git archive 3fafa78c` into `loadbearing_tanstack_start_lite/`. This leaves out `node_modules`, `.env` and untracked files. Then `git init`. **Do not overwrite the lite-adapted files already in the folder:** `AGENTS.md`, `CLAUDE.md`, `UPSTREAM.md`, `.claude/skills/`, `docs/ai/`, `docs/opinions/`, `docs/plans/` and `docs/scale/`. Extract into a temporary folder and copy across everything else.
  done: 2026-09-30
- [x] `LT0.2` **Plans home.** Create `docs/plans/` with `index.md` and `meta.json` (architecture check §13 requires the `index.md`). Copy this plan in. Start an empty `BACKLOG.md` (`schema: backlog/v1`). Delete the copied `plans/` folder, because the big kit's history does not belong to lite.
  done: 2026-09-30
- [x] `LT0.3` **`UPSTREAM.md`**: the sha, the date, the repository URL, and a table of the cut features linking to `docs/scale/`. Update it if Phase 1 or Phase 2 cuts anything the table does not name.
  done: 2026-09-30
- [x] `LT0.4` **Rename:** root `package.json` name, the compose project name, and the host ports from `1xxxx` to `2xxxx` in `.env.example`, `infra/docker-compose.yml`, `vite` config and `README.md`.
  done: 2026-09-30 — 16 host ports moved to `2xxxx` (228 replacements in 36 files); `ALLOY_PORT` stays `12345` in `.env.example` and is moved only in the local `.env`, because Alloy leaves in `LT2.4`.
- [x] `LT0.5` **Baseline:** `pnpm install && pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm check && pnpm test`. It must be green before anything is pruned.
  done: 2026-09-30 — every gate green except two test notes, neither a code defect. (1) `tests/cold/pg-partition-archive.gateway.spec.ts` needs a signed-up user on a fresh database; it leaves in `LT2.3`. (2) `tooling/scripts`: all 145 tests pass but Vitest reports `Timeout calling "onTaskUpdate"`; see `BACKLOG.md`. `check:architecture` needed two fixes first: the `docs/plans/` exemption from `LT5.1`, and five links into the big kit's dropped `plans/` folder repointed to GitHub at the cut commit.

**Exit.** An unmodified, renamed copy passes every gate.

---

### Phase 1 — Prune the slices that were not selected

**Goal.** Remove messaging, widgets and zones from every layer, and the platform pages for analytics, shards, retention and storage. Each slice comes out in reverse `add-slice.md` order: web, feature, query, content, api-client, composition, application, infrastructure, contracts, permissions.

- [x] `LT1.1` **Messaging:** `application/src/messaging`, `contracts/src/*conversation*|message*`, `pg/schema` and repositories, `feature/src/messaging`, `query/src/messaging`, content namespaces, `route/(app)/_authenticated/messages/*`, and the router. Keep the realtime transport; notifications use it.
  done: 2026-09-30 — every layer, plus the realtime `conversation` stream, the `typing` frame, `RealtimeChannels.conversation`, `NotificationRecipientReader.conversationMembers`, `MaintenanceGateway.danglingConversations`, the `message.received` kind and `messaging` category. Specs that used messaging as an example now use notifications, docs or `activity_log`. **One assertion stays red until `LT2.8`:** the partition allowlist check reads migration `0023`, which still creates the three messaging tables. Package docs still describe messaging in prose: `LT1.6`.
- [x] `LT1.2` **Widgets and zones:** `application/src/widget`, `permissions/src/widget` plus its registry entry, `ui/src/zone`, `feature/src/{widget,dashboard}` widget code, and `settings/widgets.tsx`. The dashboard becomes a static page. The rule and opinion docs were already adapted on 2026-09-30. Also drop the `check-architecture` assertion that every inline widget is placed.
  **Decided 2026-09-30: flags stay server-side only.** The only declared flag, `widget.dismissal`, leaves with widgets, so `FLAGS` becomes empty and `FlagRegistry.clientGating()` returns nothing (it was derived from widgets). A flag gates a procedure with `flags.assertOn` → `NOT_FOUND`; no flag hides UI until widgets return. Also: `core.widget.customize` in `core.permissions.ts`, `widget.default.manage` in the admin seed, the `<Widget widget="notification.bell">` in `_authenticated.tsx` (render the bell directly), `WidgetInspector` in `member-access.panel.tsx`, `WIDGET_COPY`/`ZONE_COPY`, the `widget` namespace on `dashboard.tsx` and `members.tsx`, and the `check-architecture` inline-widget assertion plus its fixture spec.
  done: 2026-09-30 — every layer, plus the `widget` module (gate, route, nav entry), the `widget_preferences` allowlist entry, the `widget` content namespace and the query keys. The bell sits in a `<Can permission="notification.inbox.read">`, the gate its widget declared, and the loader asks the same key before prefetching the count. The dashboard is a `CardGrid` of the module nav and the member count, the count behind `member.read`. `FlagRegistry` is unchanged; its client-gating set is empty. Flag specs declare an `example.rollout` fixture by stubbing `FlagRegistry.instance` (`application/tests/support/example-flag.ts`). `check-architecture` §30 is gone and §31 keeps its number, so the check now counts 30. `TenantMembershipReader` is kept though nothing reads it now: the widget preference use-case was its only reader, and it returns with widgets. **The partition allowlist assertion now also names `widget_preferences`** (migration `0047`), cleared by `LT2.8` like the messaging tables.
- [x] `LT1.3` **Platform pages:** `platform/{analytics,retention,shards,storage}.tsx` and their use-cases and procedures in `application/src/platform`. Keep accounts, entitlements, flags and status.
  done: 2026-09-30 — the four pages, their 15 procedures, use-cases, contract schemas, queries, mutations, keys, feature panels and about a hundred copy keys. **Decided 2026-09-30: tenant export and delete stay.** They lived on the storage page but do not depend on the cold tier, so both panels moved to `platform/accounts.tsx` behind the same `<Can permission="platform.tenant.manage">`. The one copy key they share, `platform.storage.filter`, keeps its name. Also removed: `TenantStorageReader` and its Postgres adapter, and `Container.hasShardMoves`, which only the shard page read. **Seven platform keys were removed here, not in `LT1.5`,** because §28 fails on a key no procedure asserts: `platform.{retention,analytics,shards}.{read,manage}` and `platform.storage.read`. Kept for later items: the projection and retention repositories and `RetentionRules` (the worker reads them; `LT1.4` and `LT2.3`), and the worker's `tenant-move` handler with `RelocateTenantUseCase` (`LT2.1`). The replica switch stays on the status page until Phase 2.
- [ ] `LT1.4` **Analytics:** `application/src/analytics`, `infrastructure/src/clickhouse`, the port `analytics.projector.ts`, the worker's `analytics.consumer.ts` and `projection.schedule.ts`, the `ch:migrate` script, and the `CLICKHOUSE_*` env vars.
- [ ] `LT1.5` **Permission catalog:** remove the keys of every cut slice from `permissions/src/catalog` and `contracts/src/catalog`, and from the seed.
- [ ] `LT1.6` **Commitlint scopes and `docs/`:** drop the cut subjects from the scopes, `docs/setup/*`, and each package's `docs/reference/*`.

**Exit.** `grep -ri "messag\|widget\|zone\|clickhouse"` finds only the notification transport and back-port notes. `pnpm check` is green.

---

### Phase 2 — Prune the data-scale and ops layer

**Goal.** One Postgres, one Redis and one MinIO, with no sharding, partitions, replica, pgbouncer, cold tier or log pipeline.

- [ ] `LT2.1` **Sharding: keep the seam, drop the operations.** Keep `primitive/shard.ts` (placements), `shard.resolver`, `DatabaseCluster`, `Container.eachShard` and the shard step in the `authed` chain, all running node 0 only. Drop the tenant-move machinery: `tenant-move.gateway`, the shard mover, `SHARD_MOVE_GRACE_DAYS`, `platform/shards.tsx`, and the `sharded` compose profile. `docs/scale/shard-nodes.md` records what to port back.
- [ ] `LT2.2` **Partitions: keep them.** Keep `partition-ddl.ts`, `TenantPartitionSeed`, `partitions.ts`, `db:partitions` and the worker's `partitions` schedule (the monthly runway). Keep `spares` if it creates partitions; drop it if it only serves shard spares (check before deleting). Drop only `partition-archive.gateway`, which leaves with retention in `LT2.3`.
- [ ] `LT2.3` **Cold tier and retention:** `cold-archive.reader`, `storage-policy.gateway`, the S3 cold adapter, the `retention` schedule, and the `minio-cold` profile. Keep S3 uploads and the doc-image sweep (`orphans`).
- [ ] `LT2.4` **Logs:** `infrastructure/src/loki`, `log.reader.ts`, and the `observability` compose profile (Loki, Alloy). `JsonLogger` to stdout stays.
- [ ] `LT2.5` **Compose:** postgres (pgvector pg17), one redis (`noeviction`, see decision 6), mailpit, and minio with minio-init. Delete the pgbouncer, replica, sharded, analytics and cold-tier services and profiles, and trim `tooling/scripts/compose.mjs` to match.
- [ ] `LT2.6` **Env:** remove the `DATABASE_SHARD_*`, `DATABASE_REPLICA_URL`, `SHARD_*`, `S3_COLD_*` and `WORKER_ANALYTICS_*` vars (`WORKER_MAINTENANCE_*` goes only if `LT2.7` drops the maintenance consumer) from each `env.ts`, `.env.example` and the CI env-coverage check.
- [ ] `LT2.7` **Worker:** keep the consumers `mail`, `notification`, `embedding` and `outbox` (the outbox guarantees at-least-once delivery for notifications), plus the `maintenance` consumer if cleanup still needs it. Keep the schedules `cleanup`, `digest`, `orphans`, `outbox-drain` and `partitions` (kept by `LT2.2`). Drop `reconcile` if it is shard-only (check before deleting).
- [ ] `LT2.8` **Migration baseline:** delete `migrations/0000`–`0051`, then run `pnpm db:generate` on the pruned schema. That runs drizzle-kit plus `partition-ddl.ts`, which writes the `PARTITION BY` clauses, and produces `0000_lite_baseline.sql`. Add hand-written SQL for extensions, seeded permission rows, and any trigger or generated column drizzle does not emit. Diff the result against a `pg_dump --schema-only` of the Phase 0 database, minus the cut tables.

**Exit.** `pnpm infra:up` starts 5 containers. A fresh `db:migrate && db:seed` works. `boot-smoke.mjs` passes for all three apps.

---

### Phase 3 — Docs: add the `owner` audience

**Goal.** Doc spaces can be `public` (anyone), `members` (the org), `granted` (named people, orgs or roles) or `owner` (the author only). Follow `add-slice.md`.

- [ ] `LT3.1` **Contract:** add `"owner"` to the `audience` enum in `contracts/src/doc/doc-space.contract.ts`. Make sure `created_by` is present in the space entity.
- [ ] `LT3.2` **Rules:** in `application/src/doc/doc-access.ts`, an `owner` space is readable and writable only when `principal.userId === space.createdBy`. The rule runs on the input set: search (`doc-search.ts`) and the tree (`doc-tree.ts`) filter before they rank. Grants are refused on `owner` spaces (a `doc.rules.ts` rule plus an error code with copy).
- [ ] `LT3.3` **Schema:** check the `audience` column type in `doc.schema.ts`. Add a migration if it is a pg enum, and an index on `(organization_id, created_by)` when `audience = 'owner'`.
- [ ] `LT3.4` **UI and i18n:** the audience picker in `feature/src/doc` gets its fourth option, with copy in the en and bn `doc` namespaces. Owner spaces never appear in `llms.txt` or the public `(shell)/docs` reader.
- [ ] `LT3.5` **Tests:** specs where another member, an admin and a public visitor all get `NOT_FOUND` (not `FORBIDDEN`, so the space's existence does not leak).
- [ ] `LT3.6` **Docs and back-port:** update `packages/application/docs/reference/doc.md` and add a big-kit `BACKLOG.md` box.

**Exit.** A manual check with users alice, bob and a signed-out visitor matches the four-audience table in `doc.md`.

---

### Phase 4 — Semantic search that works without OpenAI

**Goal.** Semantic search is controlled by one switch. `none` uses lexical Postgres search, with the same `SearchHit` shape and no API key. `openai` and `gemini` embed through the `EmbeddingProvider` port. No use-case names a vendor.

- [ ] `LT4.1` **Config:** `EMBEDDING_PROVIDER` (default `none`), plus `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` (1536), all named by purpose. Parse them in each `env.ts`. The zod schema requires a key unless the provider is `none`.
- [ ] `LT4.2` **`GeminiEmbeddingProvider`:** calls Gemini's embeddings REST endpoint with `fetch` (no SDK, so no new catalog entry), batched `batchEmbedContents`, and `outputDimensionality: 1536` so the `vector(1536)` column is shared with OpenAI. It takes `taskType` `RETRIEVAL_DOCUMENT` or `RETRIEVAL_QUERY`: add an optional `purpose: "document" | "query"` argument to `EmbeddingProvider.embed`, which OpenAI ignores. Specs use a recorded fake from `composition/src/fake`.
- [ ] `LT4.3` **Lexical fallback:** add `searchText(organizationId, query, goalIds, limit)` to `VectorStore`. The `PgVectorStore` implementation uses a generated `tsvector` on chunk `content` (a migration) with `websearch_to_tsquery('simple', …)` and `ts_rank`. `SearchDocumentsUseCase` picks the path from a `SearchMode` the container passes in. It never checks `instanceof`.
- [ ] `LT4.4` **Indexing without a provider:** with `none`, `index-document.use-case.ts` still writes chunks, with `embedding` NULL (make the column nullable). Lexical search then works on everything that was indexed.
- [ ] `LT4.5` **Switching providers:** each chunk stores `embedding_model`. Search only uses chunks from the active model. A `pnpm ai:reindex` script queues `QueueName.EMBEDDING` jobs for stale chunks. Vectors from different models are never compared.
- [ ] `LT4.6` **Composition:** a small `switch` at the one existing wiring point (`container.ts` near line 792) chooses the OpenAI provider, the Gemini provider, or no provider with lexical mode.
- [ ] `LT4.7` **Docs and back-port:** `packages/infrastructure/docs/reference/embedding.md` (the three providers, reindexing, trade-offs) and `.env.example` comments, plus a big-kit `BACKLOG.md` box.

**Exit.** Seed a document, then run search three times: with `none`, with `gemini` using a real key, and with `openai`. Each returns the seeded document at the top. With `none` there are no outbound calls.

---

### Phase 5 — Tooling, CI and the scale-up guide

**Goal.** The gates enforce the same rules at the smaller size, and the way back to the big kit is written down.

- [ ] `LT5.1` **`check-architecture.mjs`:** exempt `docs/plans/` from §15 (every path the docs name exists). Plans name files that do not exist yet; the big kit avoids this by keeping plans outside `docs/`. Then delete or relax only the checks that point at removed paths (analytics, widgets, retention). The partition, placement and shard-reader checks stay, because those seams are kept, with one line per change recorded in `tooling/docs`. Every rule-enforcing check stays.
- [ ] `LT5.2` **CI:** one Redis service. The `compose` job gets the trimmed stack. Remove the ClickHouse, shard and replica steps.
- [ ] `LT5.3` **`AGENTS.md`, `CLAUDE.md`, `README.md`:** name the kit "lite", keep every rule import, and add a pointer to `docs/scale/`.
- [x] `LT5.4` **`docs/scale/`:** written 2026-09-30, ahead of the code: `index.md` (limits in plain terms, the fix for each), `porting.md` (the procedure), one page per removed piece, `beyond-the-big-kit.md` and `back-ports.md`. Big-kit paths are written `upstream:<path>` so §15 skips them. Re-check each page's file list once Phases 1–2 have run. The original scope was: `index.md` holds a Feature | Big-kit source paths at the upstream sha | Migration | Env | Compose profile | Container wiring table. There is one page per cut feature: messaging, widgets and zones, analytics, tenant moves across shard nodes, replica and pgbouncer, split Redis, cold tier and retention, and Loki. Each page gives the port order (the `add-slice.md` order) and its gate.
- [ ] `LT5.6` **Repoint dead links.** After Phases 1–2 and `LT5.5`, run `pnpm check:architecture`. The copied `docs/opinions/` and `docs/ai/` pages link into docs that pruning removes: `packages/application/docs/reference/messaging.md`, `packages/infrastructure/docs/reference/cold-storage.md`, `docs/infra/reference/pgbouncer.md`, and others. Rewrite each as a GitHub link to the big kit at `3fafa78c`. Don't delete the sentence; the argument still applies at scale-up.
- [ ] `LT5.5` **`docs/infra/`:** trim the reference pages to postgres, redis, minio and mailpit.

**Exit.** `pnpm check:architecture` passes, and CI is green on the first push.

---

## Scale-up path (what "grow into the big kit" means)

1. **A feature at a time.** Follow `docs/scale/<feature>.md`: copy the slice's files from the big kit at the upstream sha (the scope is the same, so imports need no change), port its migration onto the lite chain, add its env vars and compose profile, and wire it in `container.ts`.
2. **Infrastructure before features.** Split Redis and add pgbouncer through `.env` and compose only. A replica, then extra shard nodes, need no schema change: the tables are already partitioned and the placements already declared (decision 5). Port the tenant-move machinery back, add `DATABASE_SHARD_<n>_URL`, and move tenants.
3. **At full scale,** lite converges on the big kit. The back-port boxes from decision 9 mean the big kit already has everything lite added.

## Verification — the whole plan

```bash
pnpm install && pnpm infra:up
pnpm db:migrate && pnpm db:seed
pnpm deps:check && pnpm repo:check && pnpm build:packages
pnpm typecheck && pnpm lint && pnpm test
pnpm check:architecture && pnpm check:contrast && pnpm check:comments
node tooling/scripts/boot-smoke.mjs   # web, worker, realtime
pnpm smoke && pnpm smoke:web
```

Manual checks with alice, bob and carol (`Correct-Horse-9`) on port 23000:

- Sign up and verify through Mailpit, which shows that the worker's mail path works.
- Invite a user to an org and grant a role. Enable 2FA and create an API key.
- Toggle a flag and an entitlement in platform admin.
- Check the docs audience matrix from `LT3`.
- Run AI search in all three modes from `LT4`.
- Confirm a notification arrives in realtime.

| Proof | Where |
|---|---|
| The `owner` audience does not leak | `packages/application/tests/doc/doc-access.spec.ts` |
| Lexical fallback has no network calls | `packages/application/tests/ai/search-documents.spec.ts` |
| Gemini request shape and dimension | `packages/infrastructure/tests/gemini/gemini-embedding.provider.spec.ts` |
| Chunks from different models are never mixed | `packages/infrastructure/tests/pg/pg-vector.store.spec.ts` |

## Not in this plan

- Billing, a marketing site and a blog. The owner chose "nothing new" beyond the three back-ported items.
- A local or self-hosted embedding model such as Ollama. That would be a third `EmbeddingProvider` adapter with no other change.
- The desktop app. It is documented in the big kit but does not exist on disk.

## Changelog

| Date | Who | Change |
|---|---|---|
| 2026-09-30 | @sami | `docs/scale/`, `UPSTREAM.md` and `docs/plans/BACKLOG.md` written ahead of `LT0.1`; `LT0.3` and `LT5.4` closed; `LT5.1` gains the `docs/plans/` exemption. |
| 2026-09-30 | @sami | Owner chose to keep the data seams: decision 5 reversed (tables stay partitioned, shard placement kept), and `LT2.1`, `LT2.2`, `LT2.8` and scale-up step 2 rewritten. Redis switched to `noeviction`. `AGENTS.md`, `CLAUDE.md` and the rules, run books and opinions were copied in and adapted ahead of `LT0.1`. |
| 2026-09-30 | @sami | Plan written from the owner's answers: kit location, docs audiences, accounts, infrastructure, extra features, npm scope. |
