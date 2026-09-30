---
title: Classes and methods
description: Role nouns for seams, technology prefixes for implementations, the method vocabulary, and the assert/can split.
---

# Classes and methods

- **Abstract seam: a plain role noun — no `I`, no `Abstract`.** `VectorStore`, `Clock`. The concrete
  implementation is technology prefix + seam name: `PgVectorStore`, `SystemClock`. That prefix is
  what makes a seam visible at a glance in the container.
- **Banned suffixes:** `Manager`, `Helper`, `Util`, `Handler`, bare `Service`. If a class fits none of
  the role nouns in `docs/opinions/classes.md`, it wants splitting.
- **Use-case entry is always `execute(principal, input)`.** Repository reads are `findBy<X>`
  (nullable) and `findBy<X>OrFail` (throws); writes are `save` and `delete`, never `update`/`insert`.
- **The `assert` vs `can` split.** `can()` answers a question; `assert()` enforces an outcome. Mixing
  them is how a UI check silently becomes the only check.
- **Explicit accessibility on every member.** An unmarked member is public by accident.
- **No exported free functions in the OOP packages** — a class with a private constructor and static
  methods is the shape. Scope is the shipped surface: **exported**, and **`src/` only**, so a spec's
  local helper is not a violation. `ui`, `query`, `feature` are exempt (React), and `apps/*` is
  outside the glob.
- **No static mutable state.** `static readonly` holding a `Map` is mutable state wearing a keyword.
  Build derived lookups once at module load and freeze them.

---

**The argument.**
[`docs/opinions/classes.md`](../../opinions/classes.md) — class-name grammar, banned suffixes, the full method vocabulary.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
