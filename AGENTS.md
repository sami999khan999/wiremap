# wiremap, on loadbearing lite

**This repository is wiremap**, a SaaS that scans repositories and shows how their code is wired:
the import graph by folder, file roles, routes, insights and an AI assistant. It is built on the
lite kit below and keeps all of its rules and seams. The live plan is
[`docs/plans/WIREMAP-PLAN.md`](docs/plans/WIREMAP-PLAN.md), and every hosting choice in it is made
to stay inside free tiers.

## The kit underneath

A pnpm-workspace starter kit for a smaller project: a TanStack Start web app, a standalone worker
and a stream process that holds every open browser stream, over a layered, port-and-adapter package
graph. Postgres + pgvector on one node, one Redis (cache and queue share it, both env vars kept),
S3, logs to stdout.

**It is the big kit (`loadbearing_tanstack_start_kit`) with the running scale stores removed and every
seam kept.** Same packages, same `@loadbearing/*` scope, same rules. The sha it was cut from is in
[`UPSTREAM.md`](UPSTREAM.md), and the way back to each removed piece is in
[`docs/scale/`](docs/scale/index.md). The live plan is in [`docs/plans/`](docs/plans/index.md).

**Start at [`docs/ai/index.md`](docs/ai/index.md).** It is a table, one row per thing you might be
about to do, naming the one or two rule files that answer it. The whole rulebook is
[`docs/ai/rules/index.md`](docs/ai/rules/index.md) — fourteen files, none longer than ~850 tokens.

**Do not work from the surrounding code's example.** This repository's conventions are stated, and a
convention you infer will be wrong in the ways that matter.

Five that cost the most when broken, before you read anything else:

- **Dependencies point one way**, and `packages/application` names no framework and never logs.
- **`//` comments only, two lines maximum.** No block comments anywhere, JSX included.
- **Every colour is `var(--<name>)`**, from the twelve `packages/ui` declares. Nothing else is a
  colour.
- **Lite removes stores, never seams.** Tables stay partitioned, repositories keep their shard
  placement, and `REDIS_CACHE_URL` / `REDIS_QUEUE_URL` stay two names. Collapsing a seam because
  only one node runs today is the rewrite this kit exists to avoid.
- **Never name yourself as author, co-author, or contributor** — not in a commit message, a pull
  request, or a branch name.

Run `pnpm check:architecture` before claiming a change is done: the assertions that typecheck, lint
and tests all pass without noticing.
