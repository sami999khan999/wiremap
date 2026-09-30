---
title: Dependencies
description: Four tiers by what a dependency can constrain, why framework-agnostic is not runtime-agnostic, and which layer may name what.
---

# Dependencies

The kit targets **React, Next.js, and TanStack Start** on the front, and **pure Node, Express,
NestJS, Fastify, and Hono** on the back. Every dependency decision is measured against that list.

**Every version lives in `pnpm-workspace.yaml`** — every version that exists, which is Tiers 1 through 3. A `package.json` writes `"zod": "catalog:"`, never
a range. One place to upgrade, and two packages cannot drift onto different majors of the same
library without somebody noticing.

---

## The four tiers

The catalog is grouped by **what a dependency is able to constrain** — not by what it does. Tier 0 is not in the catalog at all, which is the point of it.

### Tier 0 — never imported

Infrastructure the deployment provides and **no `package.json` names**: Postgres, both Redis
instances, S3/MinIO, Loki, the Alloy agent that ships stdout to it, and ClickHouse. All of them are in
`infra/docker-compose.yml` ([11](../setup/11-local-infrastructure.md)); none of them is in any
`package.json`, which is exactly why they need a tier — otherwise question 2 below answers "it does
not reach a bundle" and files a log aggregator under build tooling.

**Some of them are reached from code, and reached over a protocol is not the same as imported.**
`ClickHouseAnalyticsProjector` and `LokiLogReader` are real adapters behind real ports, and both
are `fetch` against a documented HTTP API — no `@clickhouse/client`, no Loki SDK, nothing added to a
manifest. `OpenAiEmbeddingProvider` was the first instance of that pattern; these two are why it is a
pattern rather than a one-off.

**The rule that makes this tier worth naming: a Tier 0 dependency must not appear in code at all.**
`JsonLogger` writes structured JSON to stdout and knows nothing about Loki; Alloy tails the container
and does the shipping. The day `@loadbearing/observability` imports a Loki client, swapping log
platforms stops being a config change and the argument in
[Data and scale](data-and-scale.md) for choosing one at all falls apart.

The same discipline as Tier 2, arrived at from the other direction: Tier 2 entries are quarantined
behind a port; Tier 0 entries are quarantined behind a *protocol* — stdout, SQL, S3's API — that the
code was going to speak anyway.

**The tier is decided by whether a `package.json` gains an entry, not by whether code talks to the
thing.** Postgres is Tier 2, because `pg` and `drizzle-orm` are real dependencies. ClickHouse and Loki
stay Tier 0 even though both have adapters, because reaching them cost a manifest line of exactly
zero.

That distinction is the one worth carrying. An earlier version of this page predicted that a
super-admin dashboard querying Loki's HTTP API *"would move Loki from Tier 0 to Tier 2 — a `LogReader`
port, a `LokiLogReader` adapter, and `LOKI_URL` in `ContainerConfig`,"* and warned that it would end
"swapping log platforms is a config change."

**All three of those now exist, and the warning did not come true.** The reason is worth being precise
about, because the prediction was reasonable:

- **The write path never gained a dependency.** `JsonLogger` still writes to stdout and still has
  never heard of Loki; Alloy still tails it. Swapping the log platform is still a config change,
  because the thing that would have to be rewritten is one 130-line reader.
- **The read path added no package.** `fetch` against `query_range` is the protocol the code was
  going to speak anyway — the same quarantine as SQL or S3's API, which is what Tier 0 has always
  meant here.
- **`LOKI_URL` is optional.** A deployment without it builds no reader, and nothing else changes.

The real lesson is that the tier boundary is **the manifest**, not the absence of code. A `LogReader`
port with an SDK behind it *would* have been the move to Tier 2; a `LogReader` port with `fetch`
behind it is Tier 0 with a seam. `@loadbearing/observability` importing a Loki client would still be
the failure — and this arrangement is what makes sure it never has to.

### Tier 1 — never ships

Build, test, and lint tooling. It cannot constrain a consumer, because it never reaches one.
`typescript`, `tsup`, `vitest`, `biome`, `eslint`, `drizzle-kit`, every `@types/*`.

**One exception, and it is the most consequential entry in the file: `tsup` never ships but decides
what does.** It is what makes every package ESM-only, and what decides whether a `"use client"`
directive survives into `dist/` ([06 · Package anatomy](../setup/06-package-anatomy.md)). A bundler
upgrade is a portability change wearing a dev-dependency costume.

### Tier 2 — framework-agnostic runtime

Ships, and works under every framework on the list. Split in two, because **framework-agnostic is
not runtime-agnostic**:

| | Runs in | Entries |
|---|---|---|
| **isomorphic** | server, browser, worker, webview, edge | `zod`, `@orpc/contract`, `@orpc/client` |
| **node-only** | a Node process, under any framework | `pg`, `ioredis`, `bullmq`, `drizzle-orm`, `@aws-sdk/*` |

`pg` and `ioredis` want raw TCP, so they are dead on an edge runtime — which is one config line away
in Next, not a hypothetical. **That is the whole reason each one sits behind an abstract class in
`packages/application/src/port/`.** A use-case must not learn which runtime it landed on, and the
port is what stops it finding out.

### Tier 3 — framework-scoped

Each entry names a framework. Each is quarantined to the one layer allowed to name it.

| Entry | May appear in | Why only there |
|---|---|---|
| `@orpc/server` | `packages/api-server`, `apps/*/src/server/` | The transport seam. The **adapters** — `@orpc/server/fetch`, `/node` — stay in the apps: they are what changes when the HTTP framework does. The **router half** — the `authed` chain, the error interceptor, the stream router — is bound to oRPC, not to HTTP, and lives in `api-server` because two apps mount it: `web` for every procedure, `realtime` for the streams. Copying that chain into the second app was the alternative, and it copies the subtlest code in the transport. Recorded 2026-09-26 with `plans/archive/COMMUNICATION-PERFORMANCE-PLAN.md` `CP6.4`. |
| `@tanstack/react-router` | `apps/` | Routing is app-shaped, not product-shaped. A Next app brings its own and reads paths from `@loadbearing/permissions`. |
| `@tauri-apps/api` | `apps/desktop` | Desktop shell only, and not installed — the app does not exist ([30](../setup/30-desktop-app.md)). |
| `@tanstack/react-query`, `@orpc/tanstack-query` | `packages/{query,ui,feature}` | React-scoped, which is inside the target set — all three front-end targets are React. |
| `better-auth` | `packages/auth` | Multi-framework by export map: `./node` covers Node, Express, Fastify, Nest; `./next-js` and `./tanstack-start` cover two front-ends; the core web handler covers Hono. |

`check-architecture.mjs` asserts the quarantine ([26](../setup/26-hygiene-and-ci.md)).

---

## Adding a dependency

Four questions, in order. The first "yes" decides the tier.

1. **Is it something the deployment runs rather than something the code imports?** Yes → Tier 0.
   Done.
2. **Does it reach a consumer's bundle or `dist/`?** No → Tier 1. Done.
3. **Does it name a framework, a router, or a shell?** Yes → Tier 3, and say in the catalog which
   layer may import it. A framework-scoped dependency inside `packages/` is a design mistake unless
   it is React.
4. **Otherwise → Tier 2**, and answer the second question: isomorphic, or node-only? A node-only
   addition needs a port in `application/src/port/` before any use-case can reach it.

**If a dependency would be Tier 3 and you want it in `packages/`, the answer is almost always an
abstract class instead.** That is what `port/` is for, and it is why `infrastructure` can hold `drizzle-orm`
while `application` holds a `TaskRepository` that has never heard of SQL.

---

## Families that pin their siblings exactly

Some libraries ship as a set and pin each other with an exact version rather than a caret. The four
`@orpc/*` packages do:

```
@orpc/contract → "@orpc/shared": "1.15.0"     ← exact, not ^1.15.0
@orpc/client   → "@orpc/shared": "1.15.0"
```

A skew between them therefore puts **two copies of the shared core in the tree**, which is the same
class of failure that makes `ErrorNormalizer` match structurally instead of with `instanceof`.

**Keep every member of such a family on one version line**, and say so in the catalog at each entry
— the tiering deliberately splits the `@orpc/*` group across Tier 2 and Tier 3, so adjacency cannot
be the reminder.

> [!WARNING]
> **`syncpack lint` does not catch this.** It verifies that *one* dependency carries the same range
> across every package. It has no concept of a declared group that must move together.
>
> Not theoretical: this catalog shipped `@orpc/server` at `^1.13.7` beneath a comment reading *"pin
> all four together"*, and every check in the repository passed. That is why it became the fifth
> assertion in [26](../setup/26-hygiene-and-ci.md) rather than staying a comment.

---

## React is a peer, never a dependency

`react` and `react-dom` are `peerDependencies` in `ui`, `query`, and `feature` — never `dependencies`.
The consuming app supplies the single copy, so there is no path to two Reacts in one tree and no
"invalid hook call" whose real cause is a duplicated renderer.

They live in a **named catalog** (`catalog:react`), not the default one. React moves on its own
cadence, and `catalog:react` in a `package.json` reads as a deliberate statement that this is a
React package.

---

## What is enforced, and what is not

| Rule | Enforced by |
|---|---|
| Framework-scoped entries stay out of `packages/` | `check-architecture.mjs` §1 |
| `@orpc/*` on one version line | `check-architecture.mjs` §4 |
| One range per dependency across packages | `syncpack lint` |
| Dependency ordering in `package.json` | `sherif` |
| No version published in the last 24h | pnpm `minimumReleaseAge` |
| Tier placement, and the port rule for node-only | Review |
| The server-only packages stay out of a client bundle | `biome` `noRestrictedImports`, `check-architecture.mjs` §8 |

The second-to-last row is the one to shrink.

**The ban list is the layering graph, written where a linter can read it.** `ui`, `feature`,
`query`, `errors`, `content` and `asset` may not name `application`, `infrastructure`, `auth` or
`composition`, nor `drizzle-orm`, `pg`, `ioredis`, `bullmq` or `better-auth` — every one of which
sits to their right in [Layering](../ai/rules/layering.md). `content` and `asset` were missing from
it for as long as the graph put them to the right of `composition`, which was itself wrong:
`composition` imports `content` to build the two mailers.
