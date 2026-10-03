---
title: Documentation
description: The four documentation trees and what each is for — the rules an agent loads, the argument behind them, the build order, and the running stack.
---

# Documentation

Five trees, and the split is by **what you need**, not by who is reading.

| Tree | Is | Read it |
|---|---|---|
| [`ai/`](ai/index.md) | The rules, stated flatly, routed by task | Continually, one or two files at a time |
| [`opinions/`](opinions/index.md) | The argument behind each rule — the failure it prevents, the worked example | When a rule needs settling or challenging |
| [`setup/`](setup/index.md) | The build order, from an empty directory to a running app | Once, in order |
| [`infra/`](infra/index.md) | The running stack and the log pipeline | When something is wrong with it |
| [`integrations/`](integrations/index.md) | The API, CLI, Action, MCP server, editor extension and webhooks | When connecting something to wiremap |

Beyond these, `packages/<name>/docs/` explains why each package's exports are shaped as they are —
one reference set per package, next to the code it describes. [`infra/docs/`](../infra/docs/index.md)
is the same idea for a directory that is not a package: a landing page beside the compose file,
routing to the tree above.

[How data flows](data-flow.md) sits beside this page rather than in a tree, because it is
orientation rather than a rule, an argument, a build step, or the running stack. It follows one
request from arrival to years later and names the store it touches at each point. Read it once,
before the trees, if the question is "where does anything actually go".

## Which of the first two do I read?

`ai/` holds the rule; `opinions/` holds the reason. A rule file is ~400 tokens and tells you what to
do. Its opinions page is ~2,000 and tells you why, with the failure that produced it.

**Start from `ai/`.** Every rule file ends by naming its opinions page, so following the footer is
how you get from the rule to the argument. Going the other way — reading the argument to derive the
rule — works but costs five times as much.

**When the two disagree, `opinions/` wins** and the rule file is stale. Say so rather than picking
one.
