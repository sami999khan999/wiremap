---
title: The doc renderer
description: Markdown to sanitised HTML with unified — the pipeline order and why it matters, what the sanitiser lets through, and the type stub that keeps the DOM out of this package.
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
| 2 | `remark-directive` | `::::cards` and `:::card{title=… href=…}` |
| 3 | our `blocks` transform | GitHub alerts become callouts, and cards become card markup |
| 4 | `remark-rehype` | Raw HTML is **off**: a `<script>` in the Markdown never becomes a node |
| 5 | `rehype-sanitize` | The allow-list. Everything above it is untrusted |
| 6 | `rehype-slug` | Heading ids. After the sanitiser, which would otherwise prefix them `user-content-` |
| 7 | our `links` transform | `rel="nofollow noopener noreferrer"` on every link that leaves the site |
| 8 | `rehype-highlight` | `hljs-*` classes on code. After the sanitiser, so the classes survive |

**Steps 6 to 8 are after the sanitiser on purpose.** What they add is ours, not the author's: an
id derived from the heading's text, a `rel` on a link, and a class naming a token type.

## What the sanitiser allows

GitHub's schema, plus one thing: a `class` on `div`, `span`, `p` and `a`, when it starts with
`ui-`. Those are the callout and card hooks the `blocks` transform emits. The exact shapes are in
[`docs-primitives.md`](../../../ui/docs/reference/docs-primitives.md).

An author cannot forge one. Raw HTML never reaches the sanitiser, and a directive's own
attributes are dropped, so the only way a `ui-` class appears is the transform writing it.

URLs keep GitHub's protocols: `http`, `https`, `mailto` and relative. A card's `href` is checked
again before it becomes an anchor, because a directive attribute is set on the node directly.

## Callouts carry no title

GitHub renders `> [!NOTE]` with the word "Note" above it. This renderer does not. That word would
be English whatever the reader's locale, and the callout's tone already says what kind it is.

## The type stub

`highlight.js` ships its types with `/// <reference lib="dom" />`. Imported anywhere, that puts
the DOM's `ReadableStream` and `BufferSource` over Node's in the **whole package**. It showed up
as two unrelated type errors, in the ClickHouse connection and the S3 gateway.

This package is Node-only, and a DOM global typechecking here is a bug waiting to be written. So
`tsconfig.json` maps `highlight.js` to `highlight-js.d.ts` at the package root, which declares the
one type `lowlight` imports from it, `LanguageFn`. The runtime import is unchanged.

**Remove the stub only after checking that highlight.js no longer references the DOM lib.**

## Changing the markup

`version` is stored beside every page it rendered, as `doc_pages.renderer_version`. Bump it
whenever the emitted HTML changes shape. The pages rendered by an older version can then be found
and published again.
