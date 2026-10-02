---
title: Scrollbar
description: PageScrollbar — the glass overlay for the page and the themed thin bar for every inner scroller, coloured only from the twelve tokens, and why it needs themeScope.
---

# Scrollbar

`PageScrollbar` is mounted once, in `apps/web/src/route/__root.tsx`. It wraps `GlassScroll` from
[`glass-scroll`](https://github.com/sami999khan999/glass_scroll) with `scope="all"`.

| Where | What draws the bar |
|---|---|
| The page | A glass overlay positioned by script. It takes no layout width, so nothing shifts when a page grows a scrollbar. |
| Every inner scroller: the doc sidebar, menus, code blocks, tables, text areas | The browser's own bar, thinned and coloured to match by CSS. |

## Colours come from the twelve

The theme is four `color-mix()` values over `--fg-muted`, `--fg` and `--bg`, plus a
`transparent` track. No literal colour is written, so `check-architecture` §32 holds, and the bar
follows every theme and mode.

**There is no dark palette.** The tokens already change with `data-mode`, so `colorScheme` is
`"light"`, and the package's own dark twin is never used.

## Why `themeScope="[data-theme]"`

A custom property's `var()` references are resolved on the element that declares it. Declared
only on `:root`, `var(--fg-muted)` is the page's value everywhere, including inside a
`ThemeScope`. The doc reader is one such scope: a space opens in its own theme.

So without `themeScope`, a plum-light space inside a graphite-dark page kept graphite-dark bars:
pale grey on a light page. `themeScope="[data-theme]"` re-declares the variables on every element
carrying `data-theme`, and each scroller takes the nearest scope's colours. The option was added
to the package, in 0.2.0, for this.

## Opting an element out

| Selector | Effect |
|---|---|
| `.no-glass` or `data-glass-scroll="off"` | keeps the browser's default bar |
| `.no-scrollbar` or `data-glass-scroll="hidden"` | hides the bar completely, for carousels and tab strips |

Reduced motion turns the fades off, and forced-colours mode puts the system bar back.
