---
title: Vocabulary
description: Permissions, procedures, events, queues, contract members, database objects, env vars, React.
---

# Vocabulary

## Permissions, procedures, events, queues

Four vocabularies that look alike and mean different things.

| Kind | Grammar | Example |
|---|---|---|
| **Permission key** | `<module>.<subject>.<action>[.<qualifier>]`, action **imperative** | `task.reactivate`, `task.update.self` |
| **Procedure path** | `<subject>.<action>`, mirrors the permission it requires | `task.reactivate` |
| **Activity / event name** | `<subject>.<action>`, action **past tense** | `task.reactivated` |
| **Log event code** | `<subject>.<thing>.<state>`, state **past tense** | `queue.job.failed` |
| **Log label** | fixed set, low cardinality | `app`, `env`, `level`, `event_code` |
| **Queue name** | `<domain>.<work>`, noun-ish | `embedding.generate` |
| **Repeatable job key** | `schedule.<name>` | `schedule.overdue-sweep` |
| **Feature flag** | `<slice>.<change>`, the change a kebab noun | `widget.dismissal` |
| **Widget key** | `<module>.<name>`, the module one `PermissionRegistry.modules()` knows | `member.count` |
| **Zone key** | `<page>.<region>` | `dashboard.main` |

**Permission actions are imperative because they name a capability you hold; activity names are past
tense because they record something that happened.** `task.reactivate` is a right.
`task.reactivated` is a fact. Keeping them distinct is what makes an audit log readable.

**The qualifier vocabulary is closed**: `.self`, `.goal`, `.global`, `.org`. Do not invent `.own` or
`.mine` alongside `.self`.

**The *scope* vocabulary is closed too, and it is a different axis**: `org`, `goal`, `platform`. A
qualifier narrows what a key covers inside a tenant; a scope says which set holds it. `platform` is
the one above the tenant, held only through a role in the organization marked `is_platform`, and
`CapabilitySet.can()` reaches it through a branch that consults neither the wildcard nor the `core`
exception — see
[`permissions/docs/reference/platform-scope.md`](../../packages/permissions/docs/reference/platform-scope.md).

**Procedure paths mirror their permission where the mapping is 1:1**, and the `ProcedurePermissions`
map stays explicit regardless. An identity-looking map is still the thing that fails closed when
someone adds a procedure and forgets the entry
([10](../setup/10-contracts-package.md), [24](../setup/24-web-app.md)).

**A flag names a change, a widget names a unit, and a zone names a place.** All three are dotted
like a permission key, and none of them is one. A flag is temporary and deleted after its
rollout, so its key says what is changing, not what it guards. A widget key leads with a module
so a reader can see which slice owns the card. A zone key leads with the page, because a zone
belongs to a screen, not a slice. [Visibility](visibility.md) has how the three combine.

**The mount point is a zone, never a surface.** "Surface" already means two things here:
`--surface` is one of the twelve colour tokens, and a package's `index.ts` and `import.ts` are its
import surfaces. A third meaning would turn every grep for the word into noise. So the names are
`ZoneKey`, `<Zone>` and `ui-zone`.

**REST paths** on `.route({ path })` are kebab-case, plural resources, braced params matching the
contract field name: `/tasks/{taskId}/reactivate`.

**Shard vocabulary, four words that are easy to conflate.** A **shard key** is what a request is
placed by — here the organization id, because the organization *is* the shard. A **node** is a
physical Postgres; `shard_assignments.node` is one. A **placement** is where a *table* lives —
`catalog`, `local` or `routed` — and every table has exactly one. The **directory** is
`shard_assignments`, the table mapping keys to nodes. There is deliberately no "virtual shard":
a number between the key and the node is a level nobody needed.

**A log event code is not an activity name.** An activity is a business fact a user may read
(`task.reactivated`); a log event is a diagnostic an operator reads (`queue.job.failed`). Both are
past tense because both record something that already happened, and they live in different catalogs
with different sinks — see [`@loadbearing/observability`](../../packages/observability/docs/index.md).
Never emit one where the other belongs: a business fact in stdout is lost on restart, and a
diagnostic in Postgres is a retention bill.

The sinks are the reason: activities go to a partitioned Postgres table inside the transaction and
are kept for one to two years; log events go to stdout, on to Loki, and are kept for thirty days.

**An activity name is a catalog entry, not a string.** `ACTIVITY_ACTIONS` is merged from
per-slice fragments in `packages/contracts/src/catalog/`, exactly as `DOMAIN_EVENTS` is, and
`ActivityLogger.record` takes its key union. That is not tidiness: the projection policy holds one
row per action deciding whether it reaches the analytics store and for how long, so an action with
no entry is an action with no policy. Declaring it is the first step, and the compile error at the
call site is the reminder.

The two catalogs stay separate for the reason above. A domain event carries a payload schema
because a subscriber parses it; an activity carries a label because a screen renders it. Merging
them would give every audit row a subscriber and every event a retention policy, and neither is
what either one is for.
[Data and scale](data-and-scale.md) has the full four-stream taxonomy.

**A label is not a field.** The four labels above are the *only* ones a log line may be indexed by.
Every other value — `trace_id`, `user_id`, `task_id`, `organization_id` — lives in the line body and
is queried after the label selector has narrowed the streams. A label creates one stream per distinct
value, so promoting a high-cardinality field looks like an optimisation and is the fastest way to
make the log platform unusable.

`event_code` being a label makes `EVENT_CATALOG` its cardinality budget — plus `error.raised`, the
one code that lives outside the catalog because its level is decided by the error being logged. Every
slice that adds a catalog fragment spends the budget, which is a reason to keep codes coarse.

## Error codes

`SCREAMING_SNAKE_CASE`, and the union is closed — `ERROR_CATALOG` is the whole vocabulary. A code is
a fact about a failure, never a sentence: `Error.message` **is** the code, and every word a user
reads lives in `@loadbearing/content` keyed by that code
([09](../setup/09-errors-package.md), [20](../setup/20-content-package.md)).

## Contract members

Every `*Contract` class uses the same static member names, so reading one is reading all of them.

| Member | Holds |
|---|---|
| `entity` | the full resource shape |
| `create` | creation input |
| `update` | patch input |
| `listQuery` | filter / pagination input |
| `<verb>` | any domain action's input — `reactivate`, `approve` |

Derived types follow the schema name: `TaskDto` from `entity`, `CreateTaskInput` from `create`.
**`Dto` for wire shapes, `Input` for procedure inputs**, never both on one type.

## Database

| Object | Convention | Example |
|---|---|---|
| Table | `snake_case`, **plural** | `goal_members` |
| Append-only table | `snake_case`, **singular** | `activity_log`, `task_status_history` |
| Partition | `<parent>_<yyyy>_<mm>` | `activity_log_2026_08` |
| Column | `snake_case`, singular | `assignee_id` |
| Tenant column | `organization_id`, on every domain table | `organization_id` |
| Foreign key | `<referenced_singular>_id` | `goal_id` |
| Boolean column | `is_` / `has_` prefix | `is_system` |
| Timestamp column | `<verb>ed_at` | `reactivated_at` |
| Unique index | `<table>_<cols>_uq` | `goal_member_uq` |
| Regular index | `<table>_<cols>_idx` | `goal_member_user_idx` |
| Snapshot table | `<subject>_<grain>` | `goal_risk_daily` (illustrative) |
| Enum values | `snake_case` | `in_progress` |
| Drizzle export | `camelCase` plural, matching the table | `goalMembers` |

**Zod enums mirror the DB enum values exactly** — `in_progress`, never `IN_PROGRESS` or
`InProgress`. One string travels from Postgres to a React `<select>` with no mapping layer to drift.

**Append-only tables are singular, and the exception is worth stating because it looks like a
mistake.** `goal_members` is a collection of rows you add to and remove from; `activity_log` is one
log, `task_status_history` is one history. The plural rule serves readability at a join site, and
neither of these is ever joined that way. `session` is singular too, but only because Better Auth
named it.

**`organization_id` is on every domain table, and every unique index on one leads with it.**
`roles_key_uq` on `(key)` alone means two tenants cannot both have an `owner` role.
`check-architecture.mjs` §9 holds the list of tables so that adding to it is a decision someone made
rather than a file nobody noticed.

There are exactly three kinds of exception, and each has a reason a reader can check:

| Index | Why it cannot lead with the tenant |
|---|---|
| `organizations_slug_uq` | This *is* the tenant table |
| `organizations_platform_uq` | The same table, and partial: at most one row may be the platform tier, and any number may not |
| `invitations_token_uq` | The landing page and the accept endpoint arrive holding a token and no tenant — resolving it is the point |
| `api_keys_hash_uq` | Same: a key arrives as a bare header, and the lookup is what establishes the organization |
| `invitation_links_token_uq` | Wiremap's shareable invitation: the join page arrives holding only the link's token |
| `organization_domains_domain_uq` | Wiremap's auto-join: a sign-up arrives holding only an email address, and a domain belongs to one organization |
| the Better Auth tables | Generated against that library's own schema |

**A nullable column in a unique index is not covered by it.** NULLs are distinct in Postgres, so
`permission_overrides_uq` on `(user_id, goal_id, permission)` exempted every org-scope row — the
index existed, read as a constraint, and enforced nothing for the rows that mattered most. The shape
that works is two partial indexes:

```sql
CREATE UNIQUE INDEX … ON permission_overrides (organization_id, user_id, permission)
  WHERE goal_id IS NULL;
CREATE UNIQUE INDEX … ON permission_overrides (organization_id, user_id, goal_id, permission)
  WHERE goal_id IS NOT NULL;
```

Check any unique index over a nullable column against that question before trusting it.

Spell it **`organization`**, not `organisation`, everywhere — the column name settles it, and a
codebase using both resolves it inconsistently per file.

**A snapshot table name says it is derived.** `goal_risk_daily` reads as a rollup at a grain;
`goal_risks` would read as a domain table somebody could write to. Only a projection consumer writes
to one, and it is rebuildable by replaying the activity log ([Data and scale](data-and-scale.md) §2).
The kit ships no snapshot table today — it had two, empty and unread, and they went with the port
that was supposed to read them — so the row above is a naming rule rather than a pointer.

## Packages, env, React

- **Packages:** `@loadbearing/<single-lowercase-word>`. Scope by layer, never by feature — no
  `@loadbearing/task-contracts`.
- **Env vars:** `SCREAMING_SNAKE_CASE`, prefixed by subsystem: `DATABASE_URL`, `S3_BUCKET`. Where
  one technology serves two purposes, the purpose is the prefix, not the technology —
  `REDIS_CACHE_URL` and `REDIS_QUEUE_URL`, never one `REDIS_URL`, because the two have different
  durability guarantees and mixing them loses queued work.
  Client-exposed vars carry the framework's public prefix and nothing else does. Read once in
  `apps/*/src/env.ts` and passed down — Biome's `noProcessEnv` enforces that everywhere else.
- **React components:** `PascalCase` export in a kebab-case file — `task-card.tsx` exports
  `TaskCard`.
- **Hooks:** `use<Noun>` — `useCapabilities`.
- **Props type:** `<Component>Props`, same file.
- **Handler props:** `on<Event>`; the implementations filling them: `handle<Event>`.
- **Query factories:** `<Subject>Queries` / `<Subject>Mutations` in `@loadbearing/query`, never in
  `api-client`.
- **Query keys** mirror the procedure path, params last: `["task", "list", { goalId }]`. Never
  hand-written at a call site.
