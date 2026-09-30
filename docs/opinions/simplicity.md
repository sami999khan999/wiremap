---
title: Simplicity
description: The least structure that achieves the goal — and performance is part of the goal, not the thing traded away to reach it.
---

# Simplicity

Every other page here decides *what* something is called or *where* it lives. This one decides **how
much structure** to build once those questions have an answer, and it is the tie-breaker when two
designs both satisfy every other rule.

**The rule:**

> **Build the least structure that achieves the goal. Performance is part of the goal.**

Both halves are load-bearing. Structure removed at the cost of a slower system has not been
simplified — the cost has been moved somewhere nobody is looking.

---

## Ceremony is not simplicity, and neither is terseness

Two failures, opposite in shape and equally common.

**Ceremony** is structure that exists because a pattern says it should: a folder per file, an
interface with one implementation and no prospect of a second, a config layer nothing configures.
Each looks tidy in isolation and costs a reader one more hop.

**Terseness** is removing what a reader needed: a clever one-liner, a name that saves eight
characters and an explanation, three concerns fused into one function because they happened to be
adjacent.

The test is not *how much code is there*. It is:

> **How much does someone need to hold in their head to change this safely?**

A barrel that names twenty exports is more typing than `export *` and less to hold in your head,
because widening the public API becomes visible in review. That is why `export *` is banned
([Imports and exports](imports.md)) — the longer file is the simpler one.

---

## What earns structure

A directory, a package, an abstraction, or a config layer earns its place by answering **yes** to one
of these. Not by looking like the last project.

| Structure | Earns it by |
|---|---|
| A directory | Holding more than one file, or being a path a tool requires |
| A package | Having its own dependency boundary that a folder cannot express |
| An abstraction | A second implementation existing, or being certain enough to design for |
| A config layer | Something actually varying between environments |
| A new label, tier, or catalog entry | A question somebody asks that nothing else answers |

**`infra/` is the worked example, and it failed this test badly.** It held six configuration files in
eleven directories — four of which contained no files at all, existing only as path segments:

```
infra/postgres/init/01-extensions.sql        →  infra/postgres.init.sql
infra/loki/config/loki.config.yml            →  infra/loki.config.yml
```

Every one of those directories existed because the compose file mounted a *directory* where it could
mount a *file*. The nesting bought nothing and cost a reader four hops to find a three-line SQL
script. Flattened, the names carry what the folders used to: `<subject>.<role>.<ext>`, the same
grammar as [Files](files.md).

The same page had six documentation files — `index.md`, two `meta.json`, three under `reference/` —
describing six configuration files. That structure is right for a package with thirty exports and
absurd for a directory you can read in one screen. It is now one `README.md`.

---

## Performance is a requirement, not a trade

The sentence *"we simplified it, it is a bit slower"* almost always means a cost moved from code that
is read into a system that is run. Prefer designs that are simple **and** fast; where they genuinely
conflict, say so explicitly rather than letting the simpler one win by default.

Most of the time they do not conflict, and this repository is full of the proof:

**Four queries instead of one join.** `CapabilityRepository.resolveFor()` runs four targeted
queries rather than one wide left join ([13](../setup/13-infrastructure-postgres.md)). Fewer queries sounds
simpler; the join produces a cartesian product across role permissions, goal memberships, and
overrides, and needs deduplication in application code. The four-query version is both easier to
read and faster.

The fourth is the org's entitlement, and it is itself four lookups in one statement: the plan's
rows, the unlimited marker, the live adjustments and the disabled modules, tagged and joined with
`UNION ALL`. A join across those four would multiply rows, while a union returns each lookup's rows
once, in one round trip. The union keeps the count at four without paying for it in rows.

**A grep instead of a lint plugin.** `check-architecture.mjs` is zero-dependency Node that greps for
rules no linter expresses ([26](../setup/26-hygiene-and-ci.md)). A custom ESLint plugin would be the
sophisticated answer, and it would be slower, need its own build, and be silenceable with an inline
comment.

**Two Redis instances instead of one.** More infrastructure, simpler semantics. One instance forces
one eviction policy onto two incompatible needs — `allkeys-lru` silently drops queued jobs,
`noeviction` turns a full cache into hard errors. The absence of a correct single answer is the tell
that it was two concerns wearing one container.

**A closed label set of four.** Loki could index every field. Indexing `trace_id` creates one stream
per request, which is simultaneously the more complex configuration and the one that falls over
([Data and scale](data-and-scale.md)).

**Not normalising third-party log levels.** Postgres, Redis, MinIO and ClickHouse each write severity
differently. Extracting a `level` label from all four means a regex per vendor that breaks on their
next release, in exchange for a query — `{app="postgres"} |= "ERROR"` — that Loki is already good at.
The simpler choice is also the one that keeps working.

---

## When an abstraction is worth it before the second implementation

The rule above says an abstraction earns its place when a second implementation exists. There is one
honest exception, and being precise about it is what stops it becoming a licence.

**A seam earns its place early when the swap is certain and the retrofit is not local.**
`ContentSource` has one implementation and is still right, because adding a CMS later would otherwise
mean touching every screen ([20](../setup/20-content-package.md)). `VectorStore` is the same shape:
a dedicated vector database becomes necessary at a volume this kit will not see for years, and by
then every call site would have to change.

Both pass a specific test — **the cost of adding it later is spread across the codebase rather than
concentrated in one file.** An abstraction whose future swap touches one adapter has not earned
anything; write the adapter.

### The exception has a real counter-example, and it is in this repository

`AnalyticsReader` used to be listed here, on the same argument. It had two methods, two Postgres
rollup tables, a ClickHouse implementation and an `ANALYTICS_DRIVER` flag to choose between them.
**Nothing ever called it**, and the whole apparatus was deleted.

It failed the test on the half that is easy to skip. The retrofit was not spread — a reader nothing
reads has no call sites to change, so the future cost was concentrated in exactly one file. What
made it *feel* like `ContentSource` was that the swap seemed certain; certainty about the swap is
the cheap half of the test, and on its own it justifies anything.

The rest of the pipeline is the seam done right, and it is worth seeing the two side by side.
`AnalyticsProjector` **writes** to ClickHouse, has a consumer, has a nightly reconciliation, and
ships. ClickHouse itself is in the compose file and **stopped**, and `CLICKHOUSE_URL` is unset.

**"The seam is implemented" and "the store is started" are two decisions, and only the second one is
expensive to be wrong about.** But an unused seam is not free either: it is two implementations kept
in step by hand, against a shape no consumer has ever tested. Preparing for a future twice would be
running the store; preparing for it wrongly is guessing at the interface years early.

---

## Applying it

Three questions, in order, when adding anything structural:

1. **What breaks if I leave it out?** No answer means do not add it.
2. **Is the cost of adding it later spread or local?** Local means later.
3. **Does the simpler version cost throughput, latency, or a query?** Then it is not the simpler
   version — say what it costs and choose deliberately.

**Deleting structure is a change like any other.** It gets the same verification as adding it. Every
claim in this repository's `infra/` flattening — that single-file mounts work, that Postgres still
initialises, that the four labels survive — was checked against a running stack from empty volumes,
because "it should still work" is how a simplification becomes an outage.

---

## Where this is enforced

Review, and deliberately so. A linter can count files but cannot tell ceremony from necessary
structure, and a rule that tried would produce exactly the kind of mechanical compliance this page
exists to prevent.

What review has instead is a question with a right answer: **name the thing that breaks if this
structure is removed.** If nobody can, it goes.
