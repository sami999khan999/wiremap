---
title: Comments
description: Line comments only, two lines maximum, and where the reasoning goes instead.
---

# Comments

- **Every comment is `//`. There is no second form.** No `/* */`, no JSDoc, no JSX `{/* */}` — not
  above a class, not as a separator, not for commented-out code. A comment between two JSX children
  goes in an expression container: `{`, then the `//` lines, then `}`. Enforced as a build failure
  (§5), so no inline comment can silence it.
- **Two lines is the ceiling, and it is checked (§14).** Three consecutive `//` lines fail the
  build. A `// ──` separator and a `biome-ignore` / `eslint-disable` / `@ts-` pragma end a run
  rather than extending it; generated `*.gen.ts` is skipped. Both assertions cover `{src,tests}`
  under `packages/*` **and** `apps/*`.
- **A comment's job is to stop the *next* reader misreading the line under it.** That is the test
  for keeping one. The long-form argument goes in `packages/<name>/docs/reference/`, registered in
  `reference/meta.json` and named from the parent `index.md`, where it gets reviewed like prose.
  Say the constraint in the code, leave `// see docs/reference/x.md`, and let the page carry the why.
- **Cutting one down:** delete history, war stories, setup-doc cross-references, restatements of
  these rules, pre-emptive scope defences, and any paragraph that already appears in a second file.
  What survives is the failure the line prevents.
- **Commented-out code is not a comment.** Git remembers the deleted version; a reader cannot tell a
  deliberate placeholder from a 2am regression. Write the sentence instead.
- **This is not a rule against comments.** One saying why the obvious approach is wrong is worth more
  than the line it sits above.
- **`pnpm check:comments` reports** per-package density and block counts. It never fails — §14 is
  the gate.

---

**The argument.**
[`docs/opinions/comments.md`](../../opinions/comments.md) — line comments only, the two-line ceiling, the six rewrite rules, and where the reasoning goes instead.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
