---
title: Build order
description: The thirty-one documents that build the kit from an empty directory to a running app, in the order they must be worked.
---

# Build order

Work these **in order** — each ends with a ✅ Gate, and the sequence is a real dependency chain.

**Start at [`00-README.md`](00-README.md)**, which explains how to use them, what the symbols mean,
and how to rename the scope. This page is the contents.

## Foundations

| | Document |
|---|---|
| `01` | [Prerequisites](01-prerequisites.md) |
| `02` | [Repository Skeleton](02-repo-skeleton.md) |
| `03` | [Workspace & Catalogs](03-workspace-and-catalogs.md) |
| `04` | [TypeScript Configs](04-typescript-configs.md) |
| `05` | [Lint & Format](05-lint-and-format.md) |
| `06` | [Package Anatomy](06-package-anatomy.md) |

## Packages

| | Document |
|---|---|
| `07` | [`@loadbearing/core`](07-core-package.md) |
| `08` | [`@loadbearing/permissions`](08-permissions-package.md) |
| `09` | [`@loadbearing/errors`](09-errors-package.md) |
| `09b` | [`@loadbearing/observability`](09b-observability-package.md) |
| `10` | [`@loadbearing/contracts`](10-contracts-package.md) |
| `11` | [Local Infrastructure](11-local-infrastructure.md) |
| `12` | [`@loadbearing/application`](12-application-package.md) |
| `13` | [`@loadbearing/infrastructure` — the Postgres side](13-infrastructure-postgres.md) |
| `14` | [Vector Storage](14-vector-store.md) |
| `15` | [`@loadbearing/infrastructure` — the non-Postgres adapters](15-infrastructure-package.md) |
| `16` | [`@loadbearing/auth`](16-auth-package.md) |
| `17` | [`@loadbearing/composition`](17-composition-container.md) |
| `18` | [`@loadbearing/api-client`](18-api-client-package.md) |
| `19` | [`@loadbearing/asset`](19-asset-package.md) |
| `20` | [`@loadbearing/content`](20-content-package.md) |
| `21` | [`@loadbearing/query`](21-query-package.md) |
| `22` | [`@loadbearing/ui`](22-ui-package.md) |
| `23` | [`@loadbearing/feature`](23-feature-package.md) |

## Applications

| | Document |
|---|---|
| `24` | [`apps/web` — TanStack Start + oRPC](24-web-app.md) |
| `25` | [`apps/worker` — background jobs](25-worker-app.md) |

## Hygiene and verification

| | Document |
|---|---|
| `26` | [Hygiene and CI](26-hygiene-and-ci.md) |
| `27` | [Verification and your first feature](27-verification-and-first-feature.md) |

## Reference

| | Document |
|---|---|
| `28` | [Folder structure](28-folder-structure.md) |
| `29` | [Boundaries](29-naming-and-boundaries.md) |
| `30` | [`apps/desktop` — Tauri](30-desktop-app.md) · a plan; the directory does not exist |

---

The reference documents are the two worth returning to: [`28-folder-structure.md`](28-folder-structure.md)
is the whole tree on one page, and [`29-naming-and-boundaries.md`](29-naming-and-boundaries.md) walks one
feature through every layer it touches.

For the rules themselves rather than how they were built, see [`docs/ai/`](../ai/index.md); for the
argument behind each one, [`docs/opinions/`](../opinions/index.md).
