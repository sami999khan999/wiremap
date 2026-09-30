---
title: Backlog
description: The only open ledger for the lite kit — work found and not yet planned. Items graduate into a plan or are dropped.
schema: backlog/v1
---

# Backlog

The live plan is [`LITE-KIT-PLAN.md`](LITE-KIT-PLAN.md).

Checkboxes: `[ ]` todo, `[~]` in progress, `[!]` blocked, `[x]` done, `[-]` dropped.

## 1. Found while building

- [ ] `BL.1` **`tooling/scripts` tests end in a Vitest worker timeout.** All 145 tests pass, then
  Vitest reports `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` and the run exits 1. A
  spec blocks the worker's event loop long enough (the fixture harness runs the architecture
  check synchronously) that the progress RPC times out. Seen twice on 2026-09-30, both times with
  other packages testing in parallel. Check whether the big kit at the cut commit shows the same.
