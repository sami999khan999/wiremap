---
title: Theming
description: Why a theme is two attributes rather than a provider or a compound key, what colorScheme actually fixes, and why a dark-only palette needs resolveMode.
---

# `ThemeRegistry`, `ModeRegistry`, `FontRegistry`

Appearance here is **attributes on `<html>`**. Not a context provider, not a class-name strategy,
not a set of styled-component variants.

```ts
root.dataset.theme = "ocean";              // ThemeRegistry.apply
root.dataset.mode = "dark";                // ModeRegistry.apply
root.style.colorScheme = "dark";           // …and this, which people leave out
```

Everything downstream is CSS custom properties resolving differently. No component subscribes to
anything, nothing re-renders, and adding a theme is one file in `color/` plus one entry in the
registry.

## Two attributes, not one key

The tempting shape is a flat union — `light`, `dark`, `ocean-light`, `ocean-dark` — and it is the
shape this package started with, back when there were exactly two.

It stops working the moment there are palettes. The union grows *n × m*; "does this theme have a
light variant" becomes a question you answer with string surgery; and toggling from dark to light
means computing the name of a sibling key rather than moving one attribute. Worse, `colorScheme`
gets set from the theme key, which is correct only for as long as every key happens to also be a
valid `color-scheme` value.

Two attributes keep the axes independent:

```css
[data-theme="ocean"][data-mode="light"] { … }
[data-theme="ocean"][data-mode="dark"]  { … }
[data-theme="midnight"][data-mode="dark"] { … }   /* dark only, and nothing is missing */
```

A mode toggle keeps your palette. A palette switch keeps your mode. `ThemeMeta.modes` says which
blocks a palette actually ships, so "light, dark, or both" is data rather than a naming convention.

## How Tailwind reads the attributes

The twelve names stay plain custom properties on the theme selectors, and
[`theme/tailwind.css`](../../src/style/tailwind.css) maps each to a Tailwind colour with
`@theme inline`. `inline` matters: `bg-surface` compiles to `var(--surface)` itself, so a theme swap
on `<html>`, or inside a `ThemeScope`, repaints every utility with no rebuild.

`dark:` is not Tailwind's class strategy. It is declared as
`&:where([data-mode="dark"], [data-mode="dark"] *)`, so it follows `data-mode`, including a
nested scope. Components rarely need it, because the twelve already change with the mode.

## `resolveMode` is not a nicety

```ts
ThemeRegistry.resolveMode("midnight", "light"); // "dark"
```

A dark-only palette asked to render light matches **no selector at all**. Not a fallback, not an
approximation — all twelve names resolve to nothing and the page renders as unstyled text on
white. Every path that can produce a `(theme, mode)` pair goes through `resolveMode` first: the
cookie read on the server, and the picker in the browser.

The same defect has a second cause, and `color/slate.css` closes it:

```css
:root,
[data-theme="slate"][data-mode="light"] { … }
```

A document with no attributes at all — the pre-hydration state of any page rendered without the
cookie — still resolves all twelve names. `:root` is specificity `(0,1,0)` and every theme block is
`(0,2,0)`, so the seed never interferes with a real choice.

## `colorScheme` is the line people leave out

```ts
root.style.colorScheme = "dark";
```

`data-theme` and `data-mode` style *your* markup. `colorScheme` tells the browser to restyle **its**
markup — native scrollbars, `<input type="date">` pickers, form control chrome, the canvas behind a
`<dialog>`. Without it a dark theme has light scrollbars and a white date picker, which reads as a
half-finished theme and is genuinely hard to attribute if you do not know this property exists.

It lives on `ModeRegistry` rather than on `ThemeMeta` because it is a property of the **mode**. That
is what makes `style.colorScheme = "ocean-dark"` impossible to write by accident.

## What the alternatives cost

**A React context** makes every themed component a consumer, so a theme switch re-renders the tree.
It also means a component cannot be styled before hydration, which is the flash problem below.

**Class names** (`.theme-dark .button`) work, but every rule doubles per theme and the specificity
grows with the theme count. Custom properties invert that: the rule is written once and the *value*
varies.

**Per-theme component variants** are the expensive version of the same mistake — a new theme becomes
a pass over every component instead of one CSS file.

## `system` is a preference, never a mode

```ts
ModeRegistry.resolve(preference, prefersDark);   // "system" + true -> "dark"
```

`ModePreference` is what a user stores; `ModeKey` is what renders. Nothing styles `system`, so it is
resolved before it reaches the DOM.

`resolve` takes a **boolean**, never `matchMedia` — the same reason `Locales.negotiate` takes strings
and never touches `navigator`. Reading the operating system preference is the caller's job, and the
caller differs on the two sides of SSR: the server reads the `Sec-CH-Prefers-Color-Scheme` client
hint, the browser reads the media query. Baking either in here would make the registry the arbiter of
a precedence rule it cannot see all the inputs to.

## Apply it before the first byte, not before hydration

The old fix was a synchronous `<head>` script reading `localStorage`. It works, and it is still
strictly worse than a cookie: the server renders a document with no theme, and the script corrects it.

`apps/web` reads the choice from a cookie on the server and renders `data-theme`, `data-mode` and
`color-scheme` into the HTML directly, so **the first painted byte is already correct**. What
survives as an inline script is one case the cookie cannot answer — the preference is `system` and
the request carried no client hint — and it only ever upgrades light to dark, so it can neither fight
an explicit choice nor strand a dark-only palette.

`ThemeRegistry.apply` and `ModeRegistry.apply` are still written to be callable from there: they take
an `HTMLElement` and touch nothing else, with no React dependency and no module-init side effects.

## Font choice is a token override, not a third axis

```ts
public static apply(root: HTMLElement, key: FontKey): void {
  root.style.setProperty("--font-sans", FONTS[key].stack);
}
```

The tempting design is another attribute — `light-serif`, `ocean-dark-mono` — and it multiplies:
*n* palettes × *m* modes × *k* faces, all of which have to agree about colour.

Overriding the custom property keeps them independent. A reader can pick a serif face without also
picking a colour scheme, and the registries never have to know about each other.

**Each face carries its whole stack, fallbacks included** — `'"Inter", system-ui, sans-serif'` rather
than a family plus a separate fallback list. A stack is one decision; splitting it invites a
component to reassemble it differently, and the failure is a font that silently falls back on one
platform.

## Every guard uses `Object.hasOwn`

```ts
public static isKnown(value: string): value is ThemeKey {
  return Object.hasOwn(THEMES, value);
}
```

Not `in`. `in` walks the prototype chain, so `isKnown("toString")` returns `true`, narrows to
`ThemeKey`, and `meta("toString")` hands back a function — which then fails somewhere else entirely.

These guards are exactly where an untrusted string arrives: a cookie value, a `localStorage` entry, a
query parameter. That makes this the same defect class the permission catalog had
([`permissions`](../../../permissions/docs/index.md)), in the same position, and every spec pins it
with `"toString"` and `"constructor"`.

## What is deliberately not here

**No persistence.** The registries apply an appearance; they do not remember one. Where a preference
lives — cookie, `localStorage`, a user row — differs per host, and the desktop shell has no cookie at
all. `apps/web` owns that decision in `appearance-store.ts`.

**No OS read.** See `resolve` above.

> [!NOTE]
> If a theme *preference* ever needs to persist per user rather than per browser, it is the same
> column as the locale ([`content`](../../../content/docs/index.md)), for the same reason: it is read
> on the first server render of every request.
