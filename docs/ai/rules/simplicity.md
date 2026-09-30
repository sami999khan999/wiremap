---
title: Simplicity — the tie-breaker
description: The tie-breaker when two designs satisfy every other rule: the least structure that achieves the goal.
---

# Simplicity — the tie-breaker

> **Build the least structure that achieves the goal. Performance is part of the goal.**

Both halves are load-bearing. Structure removed at the cost of a slower system has not been
simplified — the cost has moved somewhere nobody is looking.

**Ceremony** is structure a pattern demanded: a folder per file, an interface with one implementation
and no prospect of a second. **Terseness** is removing what a reader needed. The test is neither line
count nor file count: **how much must someone hold in their head to change this safely?**

A directory earns its place by holding more than one file or being a path a tool requires; a package
by having a dependency boundary a folder cannot express; an abstraction by a second implementation
existing — **with one exception: a seam earns its place early when the swap is certain and the
retrofit is spread rather than local.** An abstraction whose future swap touches one adapter has
earned nothing; write the adapter.

**Three questions when adding anything structural:** What breaks if I leave it out? Is the cost of
adding it later spread or local? Does the simpler version cost throughput, latency, or a query?

**Deleting structure is a change like any other** and gets the same verification.

---

**The argument.**
[`docs/opinions/simplicity.md`](../../opinions/simplicity.md) — how much structure to build, and why performance is part of the goal.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
