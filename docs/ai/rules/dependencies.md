---
title: Dependencies
description: The catalog, the four tiers, and the four questions that decide which tier a new dependency lands in.
---

# Dependencies

**Every version lives in `pnpm-workspace.yaml`.** A `package.json` writes `"zod": "catalog:"`, never
a range.

Four tiers by what a dependency can constrain: **0** the deployment runs it and no manifest names it
(Postgres, Redis, S3, Loki, ClickHouse) · **1** never ships (build/test/lint tooling) · **2** ships
and is framework-agnostic, split isomorphic vs node-only · **3** names a framework and is quarantined
to one layer.

**Adding one — four questions, first "yes" decides:** Does the deployment run it rather than the code
import it? Does it reach a consumer's bundle or `dist/`? Does it name a framework, router, or shell?
Otherwise Tier 2 — and **a node-only addition needs a port in `application/src/port/` before any
use-case can reach it.**

- **Tier 0 is quarantined behind a *protocol*, Tier 2 behind a *port*.** A `LogReader` with `fetch`
  behind it is Tier 0 with a seam; the same port with an SDK behind it would be Tier 2. The tier
  boundary is the manifest, not the absence of code.
- **`tsup` never ships but decides what does** — ESM-only output, and whether `"use client"` survives
  into `dist/`. A bundler upgrade is a portability change wearing a dev-dependency costume.
- **Families that pin siblings exactly stay on one version line** — all four `@orpc/*`. `syncpack`
  does not catch this, which is why it is a CI assertion.
- **React is a `peerDependency`, never a dependency**, in `ui`/`query`/`feature`, from `catalog:react`.

---

**The argument.**
[`docs/opinions/dependencies.md`](../../opinions/dependencies.md) — the four tiers, which layer may name a framework.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
