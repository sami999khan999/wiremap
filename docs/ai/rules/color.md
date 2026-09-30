---
title: Colour
description: Every colour is one of the twelve custom properties, read as var(). The one file allowed to write a literal, how to derive a state, and why a hex passes every other check.
---

# Colour

- **Every colour in this repository is `var(--<name>)`**, from the twelve `packages/ui` declares —
  and nothing else is a colour:

  ```css
  --bg  --surface  --muted  --border  --fg  --fg-muted
  --primary  --primary-fg  --success  --warning  --danger  --ring
  ```

  A hex, `rgb()`, `hsl()`, a colour keyword, or a bare `oklch()` outside
  `packages/ui/src/theme/color/` ignores the theme. It compiles, it lints, it reviews clean, and it
  is wrong in five of the six themes and in every dark mode.

- **`src/theme/color/<theme>.css` is the only file that may write a themed colour** — one per theme,
  all twelve names, once per mode. Writing there is adding a *theme*; it is never how a colour
  reaches a component. `src/theme/class/*.css` reaches `token/` and `color/` only through `var()`,
  and a literal there is a token that was never added.

- **Two exceptions, and neither is a precedent.** `token/shadow.css` writes
  `oklch(0 0 0 / <alpha>)` — a shadow is opacity over what is behind it, which is why three values
  are right in all six themes. And `packages/composition/src/mail/mail-layout.ts` writes a frozen
  set of sRGB hexes, because **a mail client resolves no CSS custom property and honours no
  `<style>` block reliably**: `var(--primary)` in an email renders as nothing at all. The values
  are slate-light converted to sRGB, they are inline on the element, and they are not the twelve —
  a message has no theme to read. Anything that moves with the theme is one of the twelve.

- **In a component, a colour is a Tailwind utility of the twelve** — `bg-surface`,
  `text-fg-muted`, `border-border` — from `packages/ui/src/theme/tailwind.css`, which resets
  Tailwind's palette so `bg-red-500` generates nothing. A derived state is an arbitrary value
  mixing two of them, `bg-[color-mix(in_oklch,var(--primary)_88%,var(--fg))]`. An arbitrary
  literal, `text-[#fff]`, compiles and is wrong in every theme.

- **Derive states, do not name them.** There is no `--primary-hover`:
  `color-mix(in oklch, var(--primary) 88%, var(--fg))` steps evenly in every theme. Twelve names is
  a set someone can hold in their head; twelve plus a hover and an active each is not.

- **A component takes a semantic tone, never a colour.** `<StatusBadge tone="danger">`, not a
  `color` prop and not `style={{ color: "#b91c1c" }}`. Components carry `ui-*` class hooks; a colour
  arriving as a prop is un-themeable from the outside.

- **Icons inherit.** Every icon in `asset` paints with `currentColor` — set `color` on an ancestor
  rather than filling a path, and one theme recolours the whole set.

- **Two of the twelve are fills, not text.** `--success` and `--warning` land at 3.5:1 and 2.6:1 on
  `--bg`; tint them into `--surface` as `StatusBadge` does. `--danger` is the only status
  colour that clears AA as a foreground.

**This is checked twice.** `pnpm check:contrast` asserts WCAG AA over the 154 pairings the
components produce and fails on a missing name or a value outside sRGB. `check-architecture` §32
fails on a colour outside the twelve in a class, a `style` prop or a stylesheet outside
`theme/color/`. Neither sees a colour built at runtime, which is why this is also a rule.

---

**The argument.**
- [`packages/ui/docs/reference/palette.md`](../../../packages/ui/docs/reference/palette.md) — the
  twelve, why `oklch()`, the sRGB gamut trap, and the four steps that add a theme.
- [`packages/ui/docs/reference/theming.md`](../../../packages/ui/docs/reference/theming.md) — why a
  theme is two attributes, `resolveMode`, and the `colorScheme` line people leave out.

When this file and `packages/ui/docs/` disagree, **`packages/ui/docs/` wins and this file is stale;
say so.**
