---
title: Folders
description: What src/ may hold, role folders vs subject folders, and the two exceptions worth knowing before you place a file.
---

# Folders

- **`src/` holds `index.ts`, `import.ts`, and folders. Nothing else.** Not a "just this one file"
  helper, not a small type. A loose file has no stated kind, so nothing says where the next one goes.
- **Every folder has an `index.ts`.** That is what lets a file move within a folder without touching
  an import elsewhere. Exemptions: `content/src/message/en/` (reached only by string-literal
  `import()`; a barrel would collapse the code-split) and directories holding no modules, such as
  `ui`'s `style/`.
- **Role folder by default, subject folder where contents repeat per feature.** A role folder names
  the kind of thing inside and uses the shared vocabulary — `catalog/`, `registry/`, `port/`,
  `primitive/`, `gate/`, `route/`, `flag/`, `widget/`, `procedure/`, `schema/`, `container/`, `fake/`, `key/`,
  `consumer/`, `subscriber/`, `schedule/`, `bootstrap/`, `component/`, `style/`. **Non-plural,
  always.** A subject folder is singular and **every file inside is prefixed with the folder's
  name**.
- **Adding a folder name is a decision.** If a new folder wants a name that already means something
  else in `docs/opinions/folders.md`, it is the wrong name.
- **Two exceptions worth knowing before you place a file.** `infrastructure` splits a slice across
  `pg/schema/` and `pg/repository/`, because drizzle needs one barrel naming every table. And
  repository *ports* live in the slice, not in `application/src/port/` — `port/` is for cross-cutting
  seams, and the test is whether a second feature adds a *method* to it or a *file beside it*.
- **Every folder under `docs/` has an `index.md`** — same rule, one level up. A folder holding no
  Markdown needs none. `reference/` folders are exempt: their parent index names every page and
  `meta.json` orders them. A CI assertion.
- **An app's root is closed too, and the exceptions are the framework's.** A file resolved by name
  stays loose — `main.ts`, `env.ts`, `apps/web`'s `router.tsx`, `endpoint.ts` and
  `route-tree.gen.ts`. Everything else is a folder: `bootstrap/` holds what a process assembles
  before it starts working.
- **Build-time artefacts and runnable scripts sit above `src/`:** `drizzle.config.ts`,
  `migrations/`, `build-sprite.mjs`, and `infrastructure/{migrate,seed,smoke}.ts` ·
  `auth/tables.ts`. A script inside a folder makes that folder's barrel execute it on import —
  which is how importing `SystemRoleSeed` once connected to Postgres mid-sign-in.

---

**The argument.**
[`docs/opinions/folders.md`](../../opinions/folders.md) — what src/ looks like, the folder vocabulary, the infrastructure exception.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
