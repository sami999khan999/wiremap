---
title: Palette
description: The twelve colour names every theme declares, why they are oklch, the sRGB gamut trap that makes a chroma lie, and the four steps that add a theme.
---

# Palettes

A theme is **one file in `src/style/color/`** declaring twelve names, twice — once for light and
once for dark. It names no component and it declares nothing structural. That is the whole contract.

## The twelve

| Name | What it is |
|---|---|
| `--bg` | the page |
| `--surface` | cards, popovers, modals |
| `--muted` | subtle fills, hover, inputs |
| `--border` | every hairline |
| `--fg` | primary text |
| `--fg-muted` | secondary text, placeholders |
| `--primary` | the brand fill |
| `--primary-fg` | text that sits on `--primary` |
| `--success` · `--warning` · `--danger` | status |
| `--ring` | the focus ring |

**Every theme declares all twelve.** The set is the contract, not a starting point: a theme that
omits one does not fall back to a sensible default, it inherits whatever `slate`'s `:root` seed left
behind — a colour from a different theme, in the right slot, silently. `check-contrast.mjs` fails on
a missing name for exactly that reason.

## Why `oklch()`

Because it makes "the same palette in another hue" a real operation rather than a redesign. Lightness
in OKLCH tracks perceived lightness, so holding `L` and moving `H` gives a theme that reads as the
same weight — which is why `ocean`, `forest` and `plum` are `slate`'s ladder at another hue and
inherit its contrast almost unchanged.

It also makes state derivation honest. There is no `--primary-hover` token because
`color-mix(in oklch, var(--primary) 88%, var(--fg))` darkens by a perceptually even step in every
theme. Twelve names is a set somebody can hold in their head; twelve plus a hover and an active for
each is not.

## The gamut trap

**sRGB does not hold the same chroma at every hue, and the browser will not tell you.** It clips
silently, so the colour on screen is not the colour in the file — and any contrast you calculated
from the file is wrong.

The spread is not subtle. At `L 0.54`:

| Hue | | Max chroma in sRGB |
|---|---|---|
| 260 | blue | **0.228** |
| 330 | magenta | 0.253 |
| 155 | green | 0.137 |
| 210 | azure | **0.094** |

`ocean` carries barely a third of `slate`'s chroma not as a style choice but because that is what the
hue can hold. Asking for more would have produced a duller colour than asking for less, because the
clip lands somewhere nobody chose.

`check-contrast.mjs` converts every declared value to linear sRGB **without clamping** and fails if a
channel leaves `[0, 1]`. That check caught three colours on the first run, including one in the
original hand-written palette.

## A grey's hue is `none`

**Write a colour with no chroma as `oklch(1 0 none)`, never `oklch(1 0 0)`.** Both draw the same
white. But `0` is a real hue, red, and `color-mix(in oklch, …)` interpolates hue. So a tint over a
`0`-hue surface is pulled toward red: a success callout at 10% green over white came out pink in
every light theme. `none` tells the mix there is no hue to blend, so the tint keeps the other
colour's hue. `check-contrast.mjs` accepts `none` and reads it as `0`, which is correct for
contrast because chroma is zero.

## Contrast is checked, not reviewed

`pnpm check:contrast` runs in CI after `check:architecture` and asserts WCAG AA over every pairing
the components actually produce — 154 of them across six themes. Two consequences worth knowing
before authoring a theme:

- **`--fg-muted` is bounded by `--muted`, not by `--bg`.** A placeholder sits inside an input. That
  pairing is the tightest in the system, and it is what fixes light `--fg-muted` at `L 0.535`.
- **`--success` and `--warning` are not text-safe on `--bg`.** At these lightnesses they land at
  3.5:1 and 2.6:1. They are fills, and `StatusBadge` tints them into `--surface` rather than
  filling with them, which puts `--fg` on a near-surface background instead. Only `--danger` clears
  AA as text, which is why the field error is the one place a status colour is a foreground.

## Adding a theme

Four steps, and none of them touch a component.

1. **`src/style/color/<name>.css`** — one block per mode, each declaring all twelve. Copy `slate.css`
   and rotate the hue; the lightness ladder is the part that should not move.
2. **`src/style/index.css`** — one `@import` line, with the other colour files, above every rule. Vite inlines
   them, so the added file costs no extra request.
3. **`src/theme/theme-registry.ts`** — one entry in `THEMES` with a `label` and the `modes` you
   actually wrote blocks for. Declaring a mode you did not write is how a page ends up with all
   twelve names undefined; `resolveMode` trusts this list.
4. **`tests/theme/theme-registry.spec.ts`** — the `all()` assertion names every key, so it fails
   until you add yours. That is the one place the CSS and the registry are checked against each
   other.

Then run `pnpm check:contrast`, and open `/kitchen-sink` in `apps/web` to look at it.

## Cost

Six themes, eleven mode blocks, 132 colours: **5.0 KB raw, 0.7 KB gzipped** once comments are stripped, one stylesheet, one
request. It is compiled into the app's one Tailwind stylesheet with the class layer and the
utilities, so it costs no request of its own.

Every theme ships to every user rather than being fetched on demand, because a lazily loaded theme
costs a round trip and a visible flash at the exact moment somebody is looking at the colours. The
browser applies only the block that matches; the rest cost parse time, not resolution time. Worth
revisiting somewhere past forty themes, and not before.

## Mail is outside the palette, and has to be

`packages/composition/src/mail/mail-layout.ts` writes literal sRGB hexes rather than any of the
twelve. That is the second exemption in [the colour rule](../../../../docs/ai/rules/color.md), and
the reason is the medium: **a mail client resolves no CSS custom property**, so `var(--primary)`
reaching an inbox renders as nothing at all — and most clients strip or ignore a `<style>` block,
which is why every value there is inline on the element.

The values are slate-light converted to sRGB, so a message looks like the product it came from. They
are deliberately *not* derived from `style/color/slate.css` at build time: a message is composed on
the server for a recipient who has no theme and no mode, so there is nothing to read a preference
from, and a pipeline that tried would have to pick one anyway.

`check:contrast` does not see them — it reads `packages/ui/src/style/color/*.css` and nothing else.
The pairings that matter there are white-on-primary for the button and `--fg` on `--surface` for the
body, both of which clear AA at the values listed, and both of which are a review item rather than a
gate.
