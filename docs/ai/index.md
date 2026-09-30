---
title: AI
description: Everything written for coding agents rather than for people. The task router — one row per thing you might be about to do — plus the rules and the skill run books it points at.
---

# AI

Material written for a coding agent to load, as opposed to `docs/opinions/` (the argument, written
to be read and reviewed) and `docs/setup/` (the build order, walked once).

`loadbearing lite` is a pnpm-workspace starter kit: TanStack Start web app + standalone worker +
stream process over a layered, port-and-adapter package graph. Postgres + pgvector on one node, one
Redis serving both the cache and the queue names, S3, logs to stdout. It is the big kit with the
running scale stores removed and every seam kept — see [`docs/scale/`](../scale/index.md).

## Open the row that matches what you are about to do

**In Claude Code you already have all of these** — `CLAUDE.md` `@`-imports every rule file, so the
table below is a map of what is in your context, not a list of things to go and fetch. It is the
entry point for any agent that reads `AGENTS.md` and not `CLAUDE.md`; none of the files is longer
than ~900 tokens, so read the one or two a task needs.

| About to | Read |
|---|---|
| Place a new file or folder | [`rules/files.md`](rules/files.md) + [`rules/folders.md`](rules/folders.md) |
| Write an import or a barrel | [`rules/imports.md`](rules/imports.md) |
| Name a class, port, or method | [`rules/classes.md`](rules/classes.md) |
| Name a permission, event, table, or env var | [`rules/vocabulary.md`](rules/vocabulary.md) |
| Add a table, migration, or store | [`rules/data.md`](rules/data.md) |
| Gate something behind a flag, a plan or a permission | [`rules/visibility.md`](rules/visibility.md) |
| Add a dependency | [`rules/dependencies.md`](rules/dependencies.md) |
| Decide which package something belongs in | [`rules/layering.md`](rules/layering.md) |
| Write a comment | [`rules/comments.md`](rules/comments.md) |
| Style anything — a colour, a component, a stylesheet | [`rules/color.md`](rules/color.md) |
| Decide how much structure to build | [`rules/simplicity.md`](rules/simplicity.md) |
| Run, verify, or commit a change | [`rules/workflow.md`](rules/workflow.md) |
| Explain something to the person you are working with | [`rules/explaining.md`](rules/explaining.md) |
| Write a commit message, a PR body, or a branch name | [`rules/workflow.md`](rules/workflow.md) — and never name yourself as author, co-author, or contributor |
| Add a feature slice | [`skills/add-slice.md`](skills/add-slice.md) |
| Write or extend a package's `docs/` | [`skills/add-docs.md`](skills/add-docs.md) |
| Get the whole rulebook, not one topic | [`rules/index.md`](rules/index.md) |
| Understand *why* a rule exists | [`docs/opinions/`](../opinions/index.md) |
| Understand how a package was built | [`docs/setup/`](../setup/00-README.md), in build order |
| Understand the running stack | [`docs/infra/`](../infra/index.md) |
| Bring back something the lite kit removed | [`docs/scale/`](../scale/index.md) — never rebuild it from memory |
| Pick up or tick off planned work | [`docs/plans/`](../plans/index.md) |

Do not work from the surrounding code's example. This repository's conventions are stated, and a
convention you infer will be wrong in the ways that matter.

## What is here

- **[`rules/`](rules/index.md)** — the rules, one file per topic. A rule is stated there when not
  knowing it causes a *silent* violation: code that compiles, lints, and passes review while being
  wrong. Everything you would naturally look up is a reference instead.
- **[`skills/`](skills/index.md)** — run books, the executable checklist form of a procedure.
  Reached by name: `/add-slice`, `/add-docs` in Claude Code, or the file directly.

## How an agent reaches this

```
CLAUDE.md                       ← Claude Code: loaded unprompted, ~9,000 tok
  ├── @AGENTS.md                ← the brief (~340 tok)
  └── @docs/ai/rules/*.md       ← all fourteen rule files, inlined at session start

AGENTS.md                       ← every other tool: the only file loaded unprompted (~340 tok)
  └── docs/ai/index.md          ← this file: routes by task (~1,700 tok)
        ├── rules/<topic>.md    ← open the one or two a task needs (~410–890 tok each)
        └── skills/<name>.md    ← the run book for a procedure

.claude/skills/<name>/          ← Claude Code only; user-invoked, points at skills/<name>.md
```

**The rulebook loads whole, and that is a deliberate reversal.** This file used to argue the
opposite — nothing loads that a task does not need, under 300 tokens unprompted, ~470 for a task
that adds a dependency. The argument was sound while context was scarce and it stopped being sound
when the window reached seven figures: fourteen rule files is **~9,100 tokens**, and a session that
needs *any* rule was already paying ~1,700 for this router plus 410–890 for the file it names, so
the true saving was never the headline number.

What lazy loading actually cost is the thing the rulebook exists to prevent. Every file here is in
`rules/` because **not knowing it causes a silent violation** — code that compiles, lints and passes
review while being wrong. That is exactly the class of rule an agent cannot know to go and look for,
because nothing in the task signals the gap. A rule that loads only when someone thinks to load it
is a rule that holds by luck.

Skill run books stay on demand. They are procedures you execute on request, not rules you must hold,
and `skills/` is another ~4,800 tokens for something a task either invokes by name or does not need
at all.

**One copy of every document, and the rest are pointers.** `skills/<name>.md` is the run book;
`.claude/skills/<name>/SKILL.md` exists so Claude Code can surface it as `/<name>` without a second
copy drifting from the first. `CLAUDE.md` imports rather than restates for the same reason — an
`@` line inlines the rule file itself, so there is nothing to keep in sync.

## What keeps it honest

`rules/` is a digest of `docs/opinions/`, which means it is a second copy of every rule it states.
`check-architecture.mjs` §12 closes that loop. It fails when an opinions page exists that no rule
file cites, when a rule file is routed to from none of `AGENTS.md`, this file, or `rules/index.md`,
when `CLAUDE.md` does not `@`-import a rule file, and when any route or import points at a path that
does not exist — backticked, as a Markdown link, or as an `@` line. A tenth opinions page cannot land
while the digest silently omits it, and a rule file cannot be orphaned, deleted, or left out of the
session load without the build noticing.

That last one is the failure this reversal would otherwise introduce. Loading the rulebook from a
hand-written list of imports means the next rule added is one someone forgot to list — routed to
correctly, read by nobody, and indistinguishable from a rule that is simply being ignored.
`explaining.md` was the thirteenth, and it is the worked example: the file, its two routes, and the
`@` line are one change because §12 fails on any of them alone.

It does **not** check that a rule file's summary of its page is still *accurate*. That is why every
file in `rules/` ends with the line saying `docs/opinions/` wins any disagreement.
