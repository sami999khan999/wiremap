---
title: "@loadbearing/asset"
description: Every binary the product ships — images behind a closed key union, icons compiled into one sprite, and the single stylesheet that declares every @font-face. No React anywhere.
---

# `@loadbearing/asset`

**No package imports a binary except this one.** Images reach the UI through
`ContentSource.media(key)`, icons through `IconRegistry` by name, fonts through a single CSS import
in [`ui`](../../ui/docs/index.md).

That one rule is why moving to a CDN or a per-tenant asset store later touches one resolver instead
of every component. If components import images directly, migrating means finding every `<img src>`
in the codebase. If they ask for `"brand.logo"`, migrating means changing one class.

| | |
| --- | --- |
| **Package** | `@loadbearing/asset` (private, never published) |
| **Entrypoint** | `src/index.ts`, plus `./font.css` and `./sprite.svg` |
| **Depends on** | **nothing** — no workspace package, no npm runtime dependency |
| **Used by** | `content` (`ImageKey`, type-only), `ui` (`IconName` + the two file entrypoints) |
| **Environment** | pure data. No React, no DOM, no server |

```
packages/asset/
├── build-sprite.mjs                ← prebuild. Fails on a hardcoded fill or stroke
├── asset.d.ts                      ← what the bundler turns a binary import into
└── src/
    ├── index.ts
    ├── icon/
    │   ├── index.ts
    │   ├── icon-registry.ts        → IconRegistry, ICON_NAMES, IconName   ← generated
    │   ├── sprite.svg              ← generated, gitignored
    │   └── svg/                    check.svg · chevron-down.svg · user.svg
    ├── image/
    │   ├── index.ts
    │   ├── image.manifest.ts       → ImageManifest, ImageKey, ImageAsset
    │   └── file/brand/logo.svg
    └── font/
        └── font.css                ← the @font-face to add; no binary ships
```

## Three entrypoints, and why this package is the exception

CSS and SVG cannot live in a JavaScript barrel, so the `exports` map has three keys instead of one —
the only package in the repository that does
([Imports and exports](../../../docs/opinions/imports.md)):

```json
".":            { "development": "./src/index.ts", "types": …, "default": … },
"./font.css":   "./src/font/font.css",
"./sprite.svg": "./src/icon/sprite.svg"
```

Both extra entries are **non-JS side-effect files that physically cannot be re-exported**. That is
the whole exemption. A package wanting extra *JavaScript* subpaths is a signal it should be two
packages.

## The sprite, and why not icon components

`build-sprite.mjs` runs as `prebuild`, so `pnpm build` cannot produce a package whose registry
disagrees with the files on disk. It writes two things: `sprite.svg`, and `icon-registry.ts`
carrying `ICON_NAMES`, `IconName` and `IconRegistry`.

**Every icon inherits `currentColor`**, so a theme recolours the whole set with no per-theme variants
and no JavaScript. `ui`'s `<Icon>` is four lines: `<svg><use href={sprite + "#" + name} /></svg>`.

**One HTTP request, cached forever.** Icon components mean every icon is JavaScript in the bundle,
parsed on every page load, whether the page renders it or not.

**Adding an icon is dropping a file in `svg/`.** The registry regenerates, `IconName` gains a member,
and a typo at a call site becomes a compile error.

The reasoning behind the two build-time checks — and the exact Biome formatting the generator has to
match — is in [`docs/reference/sprite.md`](reference/sprite.md).

## The image manifest

```ts
const IMAGES = {
  "brand.logo": { src: brandLogo, width: 160, height: 40, alt: "Loadbearing" },
} as const satisfies Record<string, ImageAsset>;
```

**The bundler fingerprints each import**, so `src` is a content-hashed URL that can be cached forever
and invalidates itself when the file changes. The Tauri bundle ships the same files and serves them
offline ([30](../../../docs/setup/30-desktop-app.md)).

**`ImageKey` is a closed union.** A content record naming a missing image is a compile error today,
and a validation error once content comes from a CMS.

**Dimensions live in the manifest** because layout shift is a real cost and `width`/`height` on an
`<img>` is the fix. Storing them beside the file is what stops them drifting from it.

`isKnown` uses `Object.hasOwn`, not `in` — `in` walks the prototype chain, so `"toString"` would pass
the guard and `get()` would hand back a function. The same bug the permission catalog had, and the
spec pins it.

## Fonts

**Variable fonts, one file per family.** A static family needs six files for six weights; the
variable version is one file covering the whole range and is usually smaller than three statics.

**`font-display: swap`** renders fallback text immediately rather than showing nothing while the font
loads. The brief flash of unstyled text is better than a blank page, and it is what the metric you
are eventually asked about measures.

**Self-hosted, never Google Fonts.** A third-party font CDN is a privacy exposure, a GDPR question, a
third-party outage in your critical path, and no faster than your own CDN under HTTP/2.

`font.css` is imported exactly once, by `packages/ui/src/theme/token/typography.css`
([22](../../../docs/setup/22-ui-package.md)).

> [!IMPORTANT]
> **No binary ships, and so no `@font-face` is declared.** `font.css` carries the block to add,
> commented, and nothing else; the build reports `fonts: 0 declared, 0 present`. The stacks in
> `typography.css` still name `Inter` and `JetBrains Mono` first, so dropping
> `inter-variable.woff2` into `src/font/` and uncommenting one block is the whole of adding a face —
> and the same stack already resolves to the family when the reader's system has it.
>
> It declared both faces against files that were never committed, which is not neutral: the browser
> requests each one, takes a 404, and falls back — a request per face per cold load, buying nothing.
>
> The check reports rather than fails, unlike the icon checks, and the difference is the failure
> mode. A missing font is visibly degraded to anyone who looks at the page. A hardcoded icon colour
> is invisible *only in dark mode*, which is how it survives for weeks. It strips CSS comments
> before it looks, so the example block above is not read as a declaration.

## What changes when assets move to a CDN

Nothing above this package. `ContentSource.media(key)` reads `ImageManifest` today; a
`CdnMediaResolver` returns a CDN URL for the same key tomorrow. Content records hold `"brand.logo"`,
never a path — so the swap is one resolver, and it incidentally makes the logo swappable per tenant,
which is worth more than it sounds for anything running client-branded portals.

> [!NOTE]
> **User uploads are not assets.** Receipts, avatars, resource-library files — those are domain data
> with permissions attached, and they go through `StorageGateway` to S3
> ([`infrastructure`](../../infrastructure/docs/index.md)). This package holds only what the product
> ships with.

## One thing this package does not have yet

**`home.hero`.** Docs 19 and 28 show a `home/hero.webp` beside the logo, and the `.d.ts` already
declares `.webp` and `.png`. Adding it is dropping the file in `image/file/home/` and one line in the
manifest — the shape is proven by `brand.logo`, which is a real SVG rather than a placeholder.
