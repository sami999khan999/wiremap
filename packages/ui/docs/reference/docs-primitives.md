---
title: Documentation primitives
description: Sidebar, NavTree, Menu, CommandDialog, Card, Prose, CodeBlock, Toc, ThemeToggle and ReaderLayout — and the exact HTML the Markdown renderer must emit for Prose to style it.
---

# Documentation primitives

Ten components make up a documentation reader. None knows what a page, a space or a search
index is. The docs slice in `feature` composes them and passes every string in.

| Export | What it is |
|---|---|
| `Sidebar` | A sticky column. Below `64rem` it becomes a drawer, controlled by `open` and `onOpenChange` |
| `NavTree` | Collapsible sections and pages, one active leaf. A section starts open; one the reader closes stays closed for the session (`sessionStorage`, read after mount so the server and first paint agree). A closed branch renders nothing, so a 2,000-page space does not hydrate every page. The caller builds each link through `renderLink` |
| `Menu` | A listbox select that shows an icon and a second line. It is the space switcher |
| `CommandDialog`, `SearchTrigger`, `useHotkey` | The Ctrl K palette, the field that opens it, and the key binding |
| `Card`, `CardGrid` | A card that is one whole link, and the grid of them |
| `Prose` | Sanitised server HTML styled as an article. Each code block gets a copy button |
| `CodeBlock` | The same code frame, for code composed in React |
| `Toc` | "On this page", with the heading under the reader marked |
| `ThemeToggle` | Light and dark as a radio pair. A mode the palette lacks is disabled |
| `ReaderLayout` | The page around them: sidebar, article, outline, and a top bar on a phone |

## Links stay the caller's

`NavTree`, `CommandDialog` and `Card` never render the router's `<Link>`. Instead they call
`renderLink(item, content, attributes)`. `attributes` is `{ className, "aria-current"? }` and must be
spread onto the caller's element, because it carries both the style and the active state.

## `CommandDialog` is not the hand-rolled Dialog

It sits on the native `<dialog>` and `showModal()`. The browser supplies the focus trap, the inert
background, Escape and the top layer. That is the headless primitive the [index](../index.md) asks
for, so no modal logic is written here.

The input keeps focus the whole time. The arrow keys move `aria-activedescendant` over the options,
and Enter clicks the active option's own anchor, so the caller's router does the navigation.

## The server HTML contract

`Prose` trusts its `html` prop. **The HTML must come out of the renderer's sanitiser**, which strips
everything except these shapes. Each shape is styled by one stylesheet, whether it came from
Markdown or from React.

| Markdown | HTML the renderer must emit | Styled by |
|---|---|---|
| `## Heading` | `<h2 id="slug">…</h2>` (h1–h4) | `prose.css`. The `id` is what `Toc` links and observes |
| A fenced code block | `<pre><code class="hljs language-ts">…</code></pre>`, with highlight.js `hljs-*` spans inside | `code-block.css` |
| `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` | `<div class="ui-callout ui-callout--info\|success\|warning\|danger"><div class="ui-callout__body">…</div></div>`, with no title: the word would be English in every locale, and the tone already says it | `callout.css`, the same markup `Callout` renders |
| `:::cards` | `<div class="ui-card-grid">…</div>` | `card.css` |
| A card with a link | `<a class="ui-card" href="…"><span class="ui-card__title">T</span><span class="ui-card__description">D</span></a>` | `card.css` |
| A card without a link | `<div class="ui-card">…same spans…</div>` | `card.css` |

Map `NOTE` to `info`, `TIP` to `success`, `IMPORTANT` to `info`, `WARNING` to `warning`, and
`CAUTION` to `danger`.

Server cards carry no `ui-card__icon`, because an icon is a `<use>` into a sprite URL that only
the bundle knows.

`Prose` wraps each `pre` in `<div class="ui-code-block">` after mount and adds a copy button to the
wrapper. One click handler on the article serves every button, and it copies the `pre`'s text, never
the button's label.

## Code colours are four of the twelve

Highlight tokens use `--primary`, `--danger`, `--fg` and `--fg-muted`, plus italic and weight, so
syntax colours move with the theme.

Code sits on `--surface`, not `--muted`. On `--muted`, several themes put `--primary` and `--danger`
under 4.5:1; on `--surface`, [`check-contrast.mjs`](../../../../tooling/scripts/check-contrast.mjs)
asserts they pass. `--success` and `--warning` never appear as text. A diff's added line is a tinted
fill instead.

The active nav item follows the same reasoning. The pill is a `--primary` tint, but its text is
`--fg`, because text on a `color-mix` is a pairing the contrast script cannot check.
