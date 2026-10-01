---
title: The doc renderer
description: Markdown to sanitised HTML with unified — the pipeline order and why it matters, what the sanitiser lets through, every directive an author can write, re-rendering after a version bump, and the type stub that keeps the DOM out of this package.
---

# The doc renderer

`UnifiedMarkdownRenderer` turns an author's Markdown into the HTML a reader sees. It runs once per
publish, and once per editor preview, and never when a page is read.

**Whatever it lets through runs in every reader's browser, with their session.** An author in one
organization writes, and every other member reads. So the renderer's first job is to be safe; its
output goes onto the page as it stands, and nothing downstream sanitises it again.

## The pipeline, in order

| Step | Plugin | Why it sits where it does |
|---|---|---|
| 1 | `remark-parse`, `remark-gfm` | Markdown and GitHub's tables, task lists and footnotes |
| 2 | `remark-directive` | Cards, tabs, steps and accordions — the `:::` blocks below |
| 3 | our `blocks` transform | GitHub alerts become callouts, and each directive becomes its `ui-*` markup |
| 4 | `remark-rehype` | Raw HTML is **off**: a `<script>` in the Markdown never becomes a node |
| 5 | `rehype-sanitize` | The allow-list. Everything above it is untrusted |
| 6 | `rehype-slug` | Heading ids. After the sanitiser, which would otherwise prefix them `user-content-` |
| 7 | our `links` transform | `rel="nofollow noopener noreferrer"` on every link that leaves the site |
| 8 | `rehype-highlight` | `hljs-*` classes on code. After the sanitiser, so the classes survive |

**Steps 6 to 8 are after the sanitiser on purpose.** What they add is ours, not the author's: an
id derived from the heading's text, a `rel` on a link, and a class naming a token type.

## What the sanitiser allows

GitHub's schema, plus two things. A `class` on `div`, `span`, `p`, `a`, `details` and `summary`,
when it starts with `ui-`: the hooks the `blocks` transform emits. And a `data-icon` on `div` and
`a`, when it is a kebab-case name: a card's icon, which `Prose` looks up in the sprite. The exact shapes are in
[`docs-primitives.md`](../../../ui/docs/reference/docs-primitives.md).

An author cannot forge one. Raw HTML never reaches the sanitiser, and a directive's own
attributes are dropped, so the only way a `ui-` class appears is the transform writing it.

URLs keep GitHub's protocols: `http`, `https`, `mailto` and relative. A card's `href` is checked
again before it becomes an anchor, because a directive attribute is set on the node directly.

## Writing each block

Every block is a `remark-directive` container. The outer fence needs **one more colon than any
fence inside it**, so a group holding cards or tabs opens with `::::`.

| Write | Get |
|---|---|
| `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | A callout in that tone |
| `::::cards` around `:::card{title="…" href="…" icon="…"}` | A grid of link cards. `icon` is a sprite name; an unknown one shows no icon |
| `::::tabs` around `:::tab{title="…"}` | Tabs. With no script every panel shows, stacked under its title |
| `:::steps` around `###` headings, one per step | Each heading numbered, on a rail down the left |
| `:::accordion{title="…"}` | A `<details>` that opens on click, with no script at all |

```md
::::tabs
:::tab{title="pnpm"}
`pnpm add @loadbearing/ui`
:::
:::tab{title="npm"}
`npm install @loadbearing/ui`
:::
::::
```

Any other directive name is put back as the text the author typed, so a typo shows up in the
preview rather than vanishing.

**Tabs are plain HTML until `Prose` mounts.** The server writes every panel; `Prose` then adds the
`tablist`, hides all panels but the first, and answers the arrow keys, Home and End. Reading the
page with scripts off, or in the raw Markdown, loses nothing.

## Callouts carry no title

GitHub renders `> [!NOTE]` with the word "Note" above it. This renderer does not. That word would
be English whatever the reader's locale, and the callout's tone already says what kind it is.

## The type stub

`highlight.js` ships its types with `/// <reference lib="dom" />`. Imported anywhere, that puts
the DOM's `ReadableStream` and `BufferSource` over Node's in the **whole package**. It showed up
as two unrelated type errors, one of them in the S3 gateway.

This package is Node-only, and a DOM global typechecking here is a bug waiting to be written. So
`tsconfig.json` maps `highlight.js` to `highlight-js.d.ts` at the package root, which declares the
one type `lowlight` imports from it, `LanguageFn`. The runtime import is unchanged.

**Remove the stub only after checking that highlight.js no longer references the DOM lib.**

## Changing the markup

`version` is stored beside every page it rendered, as `doc_pages.renderer_version`. Bump it
whenever the emitted HTML changes shape. It is **2** today: version 1 had callouts and cards only.

Then run **`pnpm doc:rerender`** with the worker up. It queues one `doc-rerender` job per
organization on the maintenance queue. `DocRerender` renders each published page the older
version wrote, 50 at a time, and writes it back:

- the published HTML, outline and `renderer_version` change;
- the search sections are rewritten, title first, as publishing writes them;
- the **revision, the draft and the publish time do not move**, so nothing shows as changed;
- the cached page is forgotten, because its key carries the revision, which stayed the same.

Rendering happens outside the transaction: it is CPU work, and an open transaction holds a
connection. A finished job logs `doc.pages.rerendered` with the count, and nothing when there was
none to do.
