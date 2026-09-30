---
title: Imports and exports
description: One entrypoint, barrels that name every export, the three import rules, and the one outside surface.
---

# Imports and exports

- **One public entrypoint: `src/index.ts`.** It re-exports and contains no logic. No deep subpaths.
  A package wanting extra JavaScript subpaths is a signal it should be two packages.
- **Barrels name every export. `export *` is banned.** A star makes the public API an accident,
  removes the private layer, and hides collisions — ESM silently drops the ambiguous name. One
  exemption: `infrastructure/src/pg/schema/index.ts`.
- **Three import rules, in priority order:** across packages, the package name via `import.ts` ·
  across folders, the folder barrel (`../primitive/index.js`) · within one folder, the direct file
  (`./app.error.js`).
- **Rule 3 is not stylistic.** Importing a sibling through your own folder barrel is the standard way
  to create a cycle, and it fails as a runtime `undefined` at module-init that looks nothing like an
  import problem. Rule 2 yields to rule 3 when a barrel would close a loop — **write the comment when
  you do.**
- **One outside surface: `src/import.ts`.** Every import from another workspace package or an npm
  dependency is written once there and re-exported; the rest of `src/` imports from `./import.js`.
  **Apps too** — `apps/worker` has one, `apps/web` has two.
- **`import.ts` re-exports external modules only. Never a relative one.** That single constraint is
  what keeps it cycle-free. It governs `src/`, not `tests/` — a spec imports its harness directly.
- **A package with no `import.ts` depends on nothing outside itself.** Never commit an empty one.
- **`apps/web` splits its surface on the server-only boundary.** `src/import.ts` is client-safe;
  `src/server/import.ts` is the only one that may name `@loadbearing/composition` and what is under
  it. One surface would put the server graph one hop from every route component.
- **Three exemptions, all forced by tooling, all commented at the line.** `apps/*/src/env.ts` keeps
  its own imports (its server-only marker cannot be re-exported) · `@tanstack/react-router` is
  direct inside `apps/web/src/route/**` (the generator prepends its own `createFileRoute` import
  otherwise) · `@tanstack/react-start` and `/server` are direct in `server/*.fn.ts` (a server
  function's stub ships to the browser, so a re-exported `/server` entry fails import protection).
- **`.js` extension on every relative import.** `apps/worker` is `NodeNext` and requires it.
- **Ordering is not yours to choose.** `biome check --write` sorts statements and specifiers.

---

**The argument.**
[`docs/opinions/imports.md`](../../opinions/imports.md) — index.ts, import.ts, the three import rules, why export * is banned.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
