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

- [ ] `UI0.1` CI green on `main` before any UI change is pushed, because it is the only proof
  nothing broke.
  - done so far: `8df785d` fixed the outbox months the baseline dropped (`pnpm smoke`).
  - `b4263aa` let `smoke:web` boot its worker and bounded every job at 30 minutes.
  - `2890e0b` makes a `boot-smoke` timeout print the app's last output.
  - **Open:** in CI, `boot-smoke.mjs web` serves `/` and then never exits after SIGTERM. It exits
    locally with the same environment.

## UI1 — wiring, no visual change

- [x] `UI1.1` Catalog entries:
  - `tailwindcss` and `@tailwindcss/vite`, Tier 1;
  - `clsx` and `tailwind-merge`, Tier 2;
  - `@base-ui/react`, React-scoped.

  `ui` depends on the last three; `apps/web` takes the first two as dev dependencies.
- [x] `UI1.2` `apps/web/src/style/app.css` is the one stylesheet, linked from `__root.tsx`.
  - It holds Tailwind's theme and utilities, with no Preflight yet, then `ui/theme.css`, then
    `ui/class.css` in `layer(components)`.
  - `@source` names `packages/ui/src` and `packages/feature/src`.
  - `tailwindcss()` is in the Vite plugins.
  - Biome parses Tailwind directives.
- [x] `UI1.3` Tokens become Tailwind's theme.
  - `token/*.css` hold `@theme static` blocks with each namespace reset, so the kit's own names
    are the only values.
  - `theme/tailwind.css` maps the twelve colours with `@theme inline`, after `--color-*: initial`.
  - The `dark` variant follows `data-mode`.
- [x] `UI1.4` `cn` is in `packages/ui/src/class-name/`, with a spec, and is exported from the
  package.

## UI2 — components to utilities, one commit each

Each commit does the same five things:
1. Utilities go in the component through `cn`. The `ui-*` hook stays first and carries no styles.
2. Variants are a frozen `Record<Variant, string>`.
3. `class/<name>.css` is deleted, along with its `@import`.
4. Hand-rolled behaviour is rebuilt on Base UI, with the same props.
5. The existing spec stays as the contract.

- [ ] `UI2.A` button, status-badge, callout, card, empty-state, code-list, qr-code, input,
  textarea, data-table, reader-layout, toc, nav-tree
- [ ] `UI2.B` field, on Base UI `Field`
- [ ] `UI2.C` popover, on Base UI `Popover`, unmounted when closed
- [ ] `UI2.D` menu, on Base UI `Select` (it is a listbox), keeping the `Menu` API
- [ ] `UI2.E` theme-toggle, on `RadioGroup`, which adds arrow-key roving
- [ ] `UI2.F` sidebar's narrow-screen drawer, on `Dialog`, which adds the focus trap
- [ ] `UI2.G` command-dialog, on `Dialog` plus `Autocomplete`
- `prose` and `code-block` style HTML that React does not render. They stay as stylesheets in the
  components layer, using only the theme.
- A Base UI portal renders outside the doc reader's nested `data-theme`. Give it a container inside
  that scope.

## UI3 — missing primitives, then consumers

- [ ] `UI3.1` `Select`, `Dialog`, `AlertDialog` and `Tooltip` in `ui`.
- [ ] `UI3.2` Replace the raw `<select className="ui-input">` elements in `feature` and in
  `-locale.tsx` with `Select`, and replace `window.confirm` in `api-key.list.tsx` with
  `AlertDialog`.
- [ ] `UI3.3` Replace `ui-stack`, `ui-organization-switcher`, `ui-reader__*` and `ui-field__hint` in
  consumers, and the kitchen sink's inline styles, with utilities. Then:
  - delete `class.css`;
  - add Preflight;
  - drop `token/space.css`'s named steps.

## UI4 — guardrails and docs

- [ ] `UI4.1` A `check-architecture` assertion: no colour outside the twelve in a `className`.
  That covers arbitrary values, colour keywords and `style` colour literals.
- [ ] `UI4.2` `check-contrast.mjs`'s pairs are re-derived from the components, and `ci.yml`'s
  stale count is fixed.
- [ ] `UI4.3` Docs:
  - `packages/ui/docs` and the component reference pages;
  - `docs/ai/rules/color.md`, `docs/ai/rules/dependencies.md` and `docs/opinions/`;
  - `docs/setup/22` (its `lead` grep matches `leading-*`);
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
