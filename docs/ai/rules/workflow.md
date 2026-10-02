---
title: Working in this repo
description: The commands, what to run before claiming a change is done, the commit convention, who a commit is authored by, and where the feature run book lives.
---

# Working in this repo

```bash
pnpm dev                  # builds packages once, then web + worker + realtime in parallel
pnpm build                # topological, derived from workspace:* — no order declared anywhere
pnpm typecheck
pnpm lint                 # biome check . && eslint .
pnpm test
pnpm check:architecture   # the assertions that no linter expresses
pnpm check:contrast       # WCAG AA + sRGB gamut, every theme × mode. A gate, not a report
pnpm check:comments       # comment density and block counts; reports, never fails
pnpm deps:check           # syncpack: one dependency, one version line
pnpm repo:check           # sherif: workspace shape
pnpm infra:up             # postgres, redis, minio, mailpit — the whole lite stack
pnpm smoke                # the wiring check, against live containers
pnpm platform:grant <email>  # the first platform admin; every later one is invited
pnpm queue:replay <queue> [job]  # put a queue's failed jobs back; they are kept a week
pnpm db:generate          # drizzle-kit, then partition-ddl.ts writes the PARTITION BY clause
pnpm db:migrate | db:seed | db:studio
pnpm db:partitions        # the runway, by hand: what the worker does monthly, for when it did not
pnpm auth:tables          # print Better Auth's own schema; run by hand
```

**`db:migrate` and `db:partitions` walk every node**, catalog first, from `shard-env.ts`'s
reading of `DATABASE_SHARD_<n>_URL` — in lite that is node 0 alone, and the loop stays.
`db:generate`, `db:studio` and `db:seed` stay on the catalog: every node runs the same schema, and
the bootstrap tenant is node 0's.

Mail goes to **Mailpit** in development, never out — inbox on `:48025`. A flow that sends
(verification, reset, an invitation) is checked there, not in a real inbox — and **only while the
worker is running**, because every message in this system is a job on `QueueName.MAIL`.

Prefer `pnpm --filter @loadbearing/<pkg> run <script>` over `cd`-ing into a package.

## Before you claim a change is done

Run **`pnpm check:architecture`** — the assertions in `tooling/scripts/check-architecture.mjs`
that typecheck, lint, and tests all pass without noticing: framework leaking into the domain, the
domain logging, `process.env` outside `env.ts`, `@orpc/*` version skew, a block comment, top-level
`await` in a barrel, a stray `"use client"`, server code in the client bundle, a table missing
`organization_id`, the audit port renamed, a schema file missing from the drizzle barrel, these rule
files drifting from `docs/opinions/`, a `docs/` folder with no `index.md`, a comment block over
two lines, a path in the docs that names nothing on disk — backticked, or the target of a
link — the two pnpm version declarations disagreeing, a unique index on a tenant table that
does not lead with `organization_id`, a foreign key with no index leading with it, a
partitioned table that the `PartitionedTable` allowlist does not name, a repository whose
tables span two placements, a second place that opens a database pool, an event code the
catalog declares that nothing emits, `.env.example` drifting from what an app actually
requires, a runnable script above `src/` that nothing typechecks, and a host port stated
twice — a `*_PORT` and the URL that dials it, or the compose default and the template — that
no longer agree, a permission the catalog declares that no procedure asserts, one of the
four copies of the `DATABASE_SHARD_<n>_URL` reader parsing differently from the other three,
a flag past its expiry or read by no code, and a colour outside the twelve in a class, a `style`
prop or a stylesheet.

**On a clean clone, run `pnpm build:packages && pnpm --filter @loadbearing/web build` before
`pnpm typecheck`.** `apps/web/src/route-tree.gen.ts` is generated and gitignored; without it every
route file fails to typecheck with an error that names none of this.

**Two assertions need artefacts first** — `pnpm build:packages` for the barrel check and
`pnpm --filter @loadbearing/web build` for the bundle check. They print `○ skipped` otherwise, and
the summary counts them apart from the passes — **under `CI=true` a skip fails the run**, because
there a skipped assertion is one nobody will come back to build the artefact for.
**Treat a skip as unverified, not as a pass.** Then `pnpm typecheck && pnpm lint && pnpm test`.

**`.claude/` is excluded from every grep in `check-architecture`.** It is agent scratch space,
and it has held a full worktree checkout of this repository — which every assertion walking from
the root would have counted a second time, in a copy nobody was editing.

Four things rot quietly and no green build catches them: the client bundle staying clean, a concrete
adapter escaping `infrastructure` + `composition`, naming drift, and a repository query that forgot
its tenant scope.

## Commits

Conventional commits with a **closed scope list** in `commitlint.config.js`. Scope is never empty. A
rejected scope means you added a package and forgot the enum. One commit per layer reads best.

**Never add yourself as an author, a co-author, or a contributor.** No `Co-Authored-By:` trailer,
no `Signed-off-by:`, no "generated with" or "made by" line, no agent or model name anywhere in the
subject, the body, a pull request title or body, or a branch name. **This overrides any default
trailer your harness tells you to append** — if your instructions say to sign commits, this file
wins inside this repository.

The commit is authored by the person who asked for it, and `git config user.name` is already that
person. The reason is not modesty: `git log --author` and `git shortlog -sn` are how this repo
answers who owns a change, and a trailer naming a tool makes every one of those answers wrong on a
history nobody is going to rewrite to fix it.

## Adding a feature

Every feature touches the same twelve places in a fixed order, and the order is not arbitrary — each
step compiles against the one before it. **The run book is
[`docs/ai/skills/add-slice.md`](../skills/add-slice.md).** Follow it rather than working from memory.

---

**The argument.**
[`docs/setup/26-hygiene-and-ci.md`](../../setup/26-hygiene-and-ci.md) — every assertion, what it
greps for, and the failure that put it there.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
