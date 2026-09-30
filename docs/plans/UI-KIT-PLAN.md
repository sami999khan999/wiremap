---
title: UI kit plan — Tailwind v4, Base UI and cn in packages/ui
updated: 2026-10-01
owner: sami
schema: plan/v1
source: owner request, 2026-10-01; two read-only surveys (ui styling and CSS pipeline, repo guardrails)
---

# UI kit plan

The owner wants lite's UI built on **Tailwind v4 utilities written in each component**, **Base UI**
headless primitives, and a **`cn`** helper (`clsx` + `tailwind-merge`). No shadcn. The move must
break no flow: every item leaves the web app, the tests and the guardrails green.

**What stays fixed:**
- the twelve colours;
- six themes × two modes on `data-theme` and `data-mode`;
- `check:contrast`;
- every component's public props;
- the `ui-*` class names, which stay as hooks that specs and callers select on.

Lite diverges from the big kit here, which is recorded in `UPSTREAM.md` at `UI4`.

## UI0 — a green baseline

- [x] `UI0.1` CI green on `main` before any UI change is pushed.
  done: 2026-10-01, run `36790382733` on `192c27d`, all three jobs.
  - `8df785d` restored the outbox months the baseline dropped (`pnpm smoke`).
  - `b4263aa` let `smoke:web` boot its worker and bounded every job at 30 minutes.
  - `2890e0b` and `295014e` make a `boot-smoke` timeout print the app's output and the libuv
    handles holding it open.
  - `192c27d` fixed the web app never exiting under CI. The one handle open was its listening
    socket: srvx skips its SIGTERM handling when `CI` or `TEST` is set, and the web app's own
    listener stopped Node's default exit.

## UI1 — wiring, no visual change

- [x] `UI1.1` Catalog entries:
  - `tailwindcss` and `@tailwindcss/vite`, Tier 1;
  - `clsx` and `tailwind-merge`, Tier 2;
  - `@base-ui/react`, React-scoped.
- [x] `UI1.2` `apps/web/src/style/app.css` is the one stylesheet. It holds Tailwind's theme and
  utilities, then `ui/theme.css`, then `ui/class.css` in `layer(components)`; `@source` names `ui`
  and `feature`.
- [x] `UI1.3` The tokens are Tailwind's theme, with each namespace reset. The twelve colours are
  the only palette, through `@theme inline`, and `dark:` follows `data-mode`.
- [x] `UI1.4` `cn` is in `packages/ui/src/class-name/`.

## UI2 — components to utilities, one commit each

- [x] `UI2.A` button, status-badge, empty-state, code-list, qr-code, data-table, toc, nav-tree,
  input, textarea, reader-layout.
  - Callers that must look like a component without being one get a class export:
    `buttonClassName`, `inputClassName`, `fieldClassName`, `readerClassName`,
    `dataTableClassName`.
- [x] `UI2.B` field, as utilities. **It stays on its own association logic.** It has no interaction
  for Base UI to take over, and Base UI's `Field` would require its own control inside.
- [x] `UI2.C` popover, on Base UI `Popover`. Focus moves in on open. It dismisses on the click that
  ends a press, and it renders in a portal.
- [x] `UI2.D` `Select` on Base UI, with `Menu` as its switcher-sized variant. The trigger is now a
  `combobox`.
- [x] `UI2.E` theme-toggle, on `RadioGroup`, with arrow keys and one tab stop.
- [x] `UI2.F` sidebar, as utilities. **Its drawer stays hand-written.** It is one element that is a
  column on a wide screen, and a Base UI `Dialog` renders only while open, in a portal. There is no
  focus trap: a gap, recorded here.
- [x] `UI2.G` command-dialog, on Base UI `Dialog`. The result list keeps its own keys, because
  Enter follows the caller's router link.
- **Kept as stylesheets:** `callout`, `card`, `prose` and `code-block`. The Markdown renderer
  writes their hooks into doc HTML that React never renders. `base.css` stays too.
- **`ThemeScope`** renders a nested `data-theme` and hands its element to every portal inside it,
  so the doc reader's panels keep its theme.

## UI3 — missing primitives, then callers

- [x] `UI3.1` `Select`, `Dialog`, `AlertDialog` and `Tooltip`. An `AlertDialog` starts on Cancel
  and ignores the backdrop.
- [x] `UI3.2` Eighteen native selects and the locale picker now use `Select`. `window.confirm` in
  the API key list is now an `AlertDialog`.
- [x] `UI3.3` Callers use utilities or the class exports.
  - `ui-stack`, which no stylesheet ever defined, is now a real vertical stack. That is the one
    intended visual change.
  - The kitchen sink is on utilities and shows every Base UI primitive.
  - **Not done, on purpose:**
    - `class.css` stays, holding `base.css` and the four Markdown stylesheets.
    - Preflight stays out. It resets list and heading defaults those stylesheets rely on, and
      Tailwind's utilities work without it.
    - The `--space-*` steps stay, because those stylesheets read them.

## UI4 — guardrails and docs

- [x] `UI4.1` `check-architecture` §32 fails on:
  - a colour outside the twelve in a class, meaning an arbitrary value, a palette utility, or
    `white`/`black`;
  - a colour literal in a `style` prop;
  - a colour literal in a stylesheet outside `theme/color/`.

  The harness counts 31. It was checked against deliberate violations.
- [x] `UI4.2` `check-contrast.mjs` pairs were re-derived from the components. It adds `--primary`
  on `--muted`, the option icon, at the non-text floor, for 154 pairings. `ci.yml`'s stale count
  is fixed.
- [x] `UI4.3` Docs:
  - `packages/ui/docs` (index, palette, theming, popover);
  - `docs/ai/rules/color.md` and `docs/ai/rules/workflow.md`;
  - `docs/opinions/dependencies.md`;
  - `docs/setup/22` (Base UI, and the `\blead\b` grep) and `docs/setup/26` (§32);
  - `apps/web/docs/reference/import-surfaces.md`;
  - `UPSTREAM.md` and `docs/scale/back-ports.md`.

## Verification

After every commit:
```bash
pnpm build:packages && pnpm --filter @loadbearing/web build
pnpm -r --no-bail run typecheck && pnpm lint
pnpm --filter @loadbearing/ui test && pnpm --filter @loadbearing/feature test
CI= node tooling/scripts/check-architecture.mjs && pnpm check:contrast
```

Then check by hand:
- `/kitchen-sink` in every theme and mode;
- keyboard use of every rebuilt component;
- the flows in [`TESTS.md`](./TESTS.md).
