---
title: Repository rules
description: The rules an agent must know unprompted, one file per topic. A digest of docs/opinions/ — that directory holds the argument, these files hold the rule.
---

# Repository rules

One file per topic, none longer than ~900 tokens, ~9,100 for all fourteen. Procedures that touch many
files in a fixed order are run books instead, in [`../skills/`](../skills/index.md) — adding a
feature slice, writing a package's docs.

**In Claude Code every file below is already loaded** — `CLAUDE.md` `@`-imports the lot, so this page
is an index of what you are holding rather than a fetch list. Any other agent starts at
[`AGENTS.md`](../../../AGENTS.md) and routes through [`docs/ai/index.md`](../index.md), which names
the one or two files that answer a given task.

| File | Decides |
|---|---|
| [`layering.md`](layering.md) | The one-way dependency graph, the server-only boundary, where an adapter may be named |
| [`files.md`](files.md) | Kebab-case, the closed role-suffix set, one class per file, where tests go |
| [`folders.md`](folders.md) | What `src/` may hold, role vs subject folders, the two exceptions |
| [`imports.md`](imports.md) | One entrypoint, no `export *`, the three import rules, `import.ts` |
| [`classes.md`](classes.md) | Seam nouns, technology prefixes, the method vocabulary, `assert` vs `can` |
| [`comments.md`](comments.md) | `//` only, two lines, where the reasoning goes instead |
| [`color.md`](color.md) | The twelve custom properties, the one file that may write a literal, deriving a state |
| [`dependencies.md`](dependencies.md) | The catalog, the four tiers, what a new dependency needs |
| [`vocabulary.md`](vocabulary.md) | Permission vs procedure vs activity vs log code, and the naming that bites |
| [`data.md`](data.md) | Which store owns which data, and what every new schema must carry |
| [`visibility.md`](visibility.md) | Flag, entitlement, permission — which hides what, and in what order |
| [`simplicity.md`](simplicity.md) | The tie-breaker when two designs satisfy every other rule |
| [`workflow.md`](workflow.md) | Commands, what to run before claiming done, commits and who authors them, adding a feature |
| [`explaining.md`](explaining.md) | Answering a person: what to lead with, whose words to use, and verifying before you explain |

## What is in these files and what is not

A rule is stated here when not knowing it causes a *silent* violation — code that compiles, lints,
and passes review while being wrong. Everything you would naturally look up is a reference instead.
The full argument for every rule — the failure it prevents, the worked example — lives in
`docs/opinions/`. **When a file here and `docs/opinions/` disagree, `docs/opinions/` wins and the
file here is stale; say so.**

## The two tests every rule serves

1. **Given a feature name and a layer, you can write the file path, the folder, and the class name
   without looking anything up.**
2. **Given a fact the system produces, you can say which store owns it without another
   conversation.**

A rule that stops producing either has a gap worth fixing rather than working around.

## Where the full argument lives

Every file above ends by naming its page in [`docs/opinions/`](../../opinions/index.md) — the
argument for each rule, the failure it prevents, the worked example. Start from a rule file and
follow its footer; do not re-derive a convention from surrounding code when `docs/opinions/` states
it.

Beyond that: `packages/<name>/docs/` is why an export is shaped as it is, and
[`docs/setup/28-folder-structure.md`](../../setup/28-folder-structure.md) is the whole tree on one
page.

**This is checked** — `check-architecture.mjs` §12 fails if an opinions page exists that no rule
file cites, if a rule file is routed to from none of `AGENTS.md`, [`docs/ai/index.md`](../index.md),
or here, if `CLAUDE.md` does not `@`-import a rule file, or if any route or import points at a path
that does not exist. Adding a file to this folder without adding its import fails the build.
