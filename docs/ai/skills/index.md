---
title: Skills
description: Run books — the executable checklist form of a procedure that touches many packages in a fixed order.
---

# Skills

A skill is a **run book**: the checklist form of a procedure that touches many places in an order
that matters. Not a rule (that is [`../rules/`](../rules/index.md)) and not an explanation (that is
[`docs/opinions/`](../../opinions/index.md)) — the steps, in sequence, with what to verify.

| Run book | Covers |
|---|---|
| [`add-slice.md`](add-slice.md) | Adding a feature slice — the twelve steps through permissions, contracts, infrastructure, application, query, content, feature, and the web app |
| [`add-docs.md`](add-docs.md) | Writing a package's `docs/` — what `index.md` must answer, when a reference page earns its place, the `meta.json` that orders them |

## How these are reached

Each run book is one file here, and every other reference to it is a pointer:

- **Claude Code** — `.claude/skills/<name>/SKILL.md`, surfaced as `/<name>`. User-invoked; type it.
- **Any agent** — the task router in [`../index.md`](../index.md) names the file directly.
- **A person** — this page.

**One copy, and the rest are pointers.** A run book duplicated into a tool's own format is a run
book that drifts from the one people actually follow.

## Adding one

A procedure earns a run book when it touches more than one package in an order that is not
obvious, and getting the order wrong costs a rewrite rather than a review comment. Anything
smaller is a rule; anything larger is a document in [`docs/setup/`](../../setup/index.md).
