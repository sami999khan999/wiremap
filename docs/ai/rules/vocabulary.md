---
title: Vocabulary
description: Four grammars that look alike and mean different things, plus the naming rules whose violation is silent.
---

# Vocabulary

Seven vocabularies that look alike and mean different things. Getting the tense wrong is the silent
failure — a permission is a right you hold, an activity is a fact that happened.

| Kind | Grammar | Example |
|---|---|---|
| Permission key | `<module>.<subject>.<action>`, **imperative** | `task.reactivate` |
| Procedure path | `<subject>.<action>`, mirrors its permission | `task.reactivate` |
| Activity / event name | `<subject>.<action>`, **past tense** | `task.reactivated` |
| Log event code | `<subject>.<thing>.<state>`, **past tense** | `queue.job.failed` |
| Feature flag | `<slice>.<change>`, a kebab noun | `widget.dismissal` |
| Widget key | `<module>.<name>`, `<module>` a real module | `member.count` |
| Zone key | `<page>.<region>` | `dashboard.main` |

- **A zone, never a surface.** `--surface` is a colour token and "surface" is a package's import
  surface already. The names are `ZoneKey`, `<Zone>`, `ui-zone`.

- **The qualifier vocabulary is closed:** `.self`, `.goal`, `.global`, `.org`. Never `.own`/`.mine`.
- **The scope vocabulary is closed and is a different axis:** `org`, `goal`, `platform`. A
  qualifier narrows a key inside a tenant; a scope says which set holds it. `platform` is held
  only through a role in the organization marked `is_platform`, and no tenant wildcard reaches it.
- **An activity name is not a log event code.** A business fact in stdout is lost on restart; a
  diagnostic in Postgres is a retention bill.
- **Log labels are a fixed set of four:** `app`, `env`, `level`, `event_code`. Everything else —
  `trace_id`, `user_id`, `organization_id` — lives in the line body. A label creates one stream per
  distinct value; promoting a high-cardinality field looks like an optimisation and is the fastest
  way to make the log platform unusable.
- **Error codes are `SCREAMING_SNAKE_CASE` and the union is closed.** `Error.message` **is** the code;
  every word a user reads lives in `@loadbearing/content`. A new code cannot ship without copy — the
  `Record<ErrorCode, ShellMessageKey>` will not compile.
- **`organization_id` on every domain table, and every unique index on one leads with it.**
  `roles_key_uq` on `(key)` alone means two tenants cannot both have an `owner` role. The only
  exceptions are the tenant table and the two lookups that arrive holding no tenant —
  `invitations_token_uq`, `api_keys_hash_uq`, and wiremap's `invitation_links_token_uq` and `organization_domains_domain_uq` (a link's token, a sign-up's email domain) — plus Better Auth's own tables. Both halves are CI
  assertions. Spell it `organization`, never `organisation`.
- **A nullable column in a unique index is not covered by it.** NULLs are distinct, so a unique
  index over one enforces nothing for the rows where it is null. Two partial indexes, split on
  `IS NULL` / `IS NOT NULL`, is the shape that works.
- **Tables are `snake_case` plural; append-only tables are singular** (`activity_log`). **Zod enums
  mirror the DB enum values exactly** — `in_progress`, never `IN_PROGRESS`.
- **Env vars are prefixed by purpose, not technology:** `REDIS_CACHE_URL` and `REDIS_QUEUE_URL`,
  never one `REDIS_URL` — the two have different durability guarantees and mixing them loses queued
  work. Read once in `apps/*/src/env.ts` and passed down; `process.env` appears nowhere else.

Full naming tables — database objects, React, contract members, query keys — in
`docs/opinions/vocabulary.md`.

---

**The argument.**
[`docs/opinions/vocabulary.md`](../../opinions/vocabulary.md) — permissions, procedures, events, queues, database, env, React.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
