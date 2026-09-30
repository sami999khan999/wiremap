# 19 · `@loadbearing/asset`

> Every binary the product ships: images, the icon sprite, and font files. No React anywhere.

**Delivers:** `ImageManifest`, `IconRegistry`, a build-time SVG sprite, and the one CSS file that declares every `@font-face`.

**Prerequisite:** [18 · `@loadbearing/api-client`](18-api-client-package.md)

---

## The rule this package exists to enforce

**No package imports a binary except this one.** Images reach the UI through `ContentSource.media(key)`, icons through `IconRegistry` by name, fonts through a single CSS import in `ui`.

That single rule is why swapping to a CDN or a per-tenant asset store later touches one resolver instead of every component. If components import images directly, migrating means finding every `<img src>` in the codebase; if they ask for `"home.hero"`, migrating means changing one class.

**No React here.** Icons are SVG files compiled into a sprite at build time, not components. That keeps this package pure data, which is what lets React-free consumers like `content` and `apps/worker` import it.

```
packages/asset/
├── build-sprite.mjs
├── asset.d.ts                  ← module declarations for .svg / .webp / .woff2
└── src/
    ├── index.ts
    ├── image/
    │   ├── index.ts
    │   ├── image.manifest.ts       → ImageManifest, ImageKey
    │   └── file/
    │       ├── brand/logo.svg
    │       └── home/hero.webp
    ├── icon/
    │   ├── index.ts
    │   ├── icon-registry.ts        → IconRegistry, IconName
    │   ├── sprite.svg              ← generated, gitignored
    │   └── svg/
    │       ├── check.svg
    │       ├── chevron-down.svg
    │       └── user.svg
    └── font/
        ├── font.css
        └── inter-variable.woff2
```

---

## Step 19.1 — Package exports

CSS and SVG cannot live in a JavaScript barrel, so this package has three entrypoints instead of one — the only package that does.

**`packages/asset/package.json`** — replace the scaffolded `exports`:

```json
"exports": {
  ".": {
    "development": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  },
  "./font.css": "./src/font/font.css",
  "./sprite.svg": "./src/icon/sprite.svg"
},
"scripts": {
  "prebuild": "node build-sprite.mjs",
  "build": "tsup",
  "dev": "node build-sprite.mjs && tsup --watch",
  "typecheck": "tsc --noEmit",
  "test": "vitest run --passWithNoTests",
  "clean": "rimraf dist src/icon/sprite.svg"
}
```

**No per-package `lint` script.** Lint is root-only in this repository — `pnpm lint` is
`biome check . && eslint .`, keyed on file globs so no package can quietly opt itself out
([05](05-lint-and-format.md)). And `test` stays, or `pnpm -r test` skips the package entirely.

**`tsup` needs a loader map, which is unique to this package:**

```ts
// packages/asset/tsup.config.ts
loader: {
  ".svg": "file",
  ".webp": "file",
  ".png": "file",
  ".woff2": "file",
},
```

Without it esbuild fails with *"No loader is configured for .svg files"* the moment
`image.manifest.ts` imports one. `file` copies each binary into `dist/` under a content-hashed name
and hands the import a URL — which is what makes `ImageAsset.src` cacheable forever and
self-invalidating.

Add to the root `.gitignore`:

```gitignore
packages/asset/src/icon/sprite.svg
```
> Generated output. Committing it means every icon addition produces a merge conflict in a file nobody reads.

---

## Step 19.2 — The icon sprite

**`packages/asset/build-sprite.mjs`**

```js
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const SOURCE = "src/icon/svg";
const OUTPUT = "src/icon/sprite.svg";
const REGISTRY = "src/icon/icon-registry.ts";
const FONT_CSS = "src/font/font.css";

const files = readdirSync(SOURCE).filter((f) => f.endsWith(".svg")).sort();
const symbols = [];
const names = [];
const problems = [];

for (const file of files) {
  const name = basename(file, ".svg");
  const raw = readFileSync(join(SOURCE, file), "utf8");

  // A hardcoded colour produces an icon that is invisible in dark mode and goes
  // unnoticed for weeks. Fail the build instead.
  if (/(fill|stroke)=["'](?!none|currentColor)[^"']+["']/.test(raw)) {
    problems.push(`${file}: hardcoded fill or stroke — use currentColor`);
    continue;
  }

  const viewBox = /viewBox=["']([^"']+)["']/.exec(raw)?.[1];
  if (!viewBox) {
    problems.push(`${file}: missing viewBox`);
    continue;
  }

  const body = raw
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>/, "")
    .trim();

  symbols.push(`  <symbol id="${name}" viewBox="${viewBox}">${body}</symbol>`);
  names.push(name);
}

if (problems.length > 0) {
  console.error("Icon sprite build failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

writeFileSync(
  OUTPUT,
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join("\n")}\n</svg>\n`,
);

// Biome collapses an array literal onto one line when it fits inside `lineWidth` and
// expands it one entry per line when it does not. Emitting anything else means every icon
// addition shows up twice — once here, and again as a reformat on the next `pnpm check`,
// in a file marked "do not edit".
const inline = `export const ICON_NAMES = [${names.map((n) => `"${n}"`).join(", ")}] as const;`;
const declaration =
  inline.length <= 100
    ? inline
    : `export const ICON_NAMES = [\n${names.map((n) => `  "${n}",`).join("\n")}\n] as const;`;

writeFileSync(
  REGISTRY,
  `// Generated by build-sprite.mjs. Do not edit.
${declaration}

export type IconName = (typeof ICON_NAMES)[number];

export class IconRegistry {
  private constructor() {}

  public static all(): readonly IconName[] {
    return ICON_NAMES;
  }

  public static isKnown(value: string): value is IconName {
    return (ICON_NAMES as readonly string[]).includes(value);
  }
}
`,
);

console.log(`sprite: ${names.length} icons`);

// Every `src: url(…)` in font.css, checked against the directory. A missing woff2 is a
// 404 the browser silently falls back from — degraded rather than broken, which is why
// this reports instead of exiting non-zero the way the icon checks do.
const css = readFileSync(FONT_CSS, "utf8");
const referenced = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]);
const missing = referenced.filter(
  (href) => !existsSync(resolve(dirname(FONT_CSS), href.split("?")[0])),
);

console.log(`fonts: ${referenced.length} declared, ${referenced.length - missing.length} present`);
for (const href of missing) {
  console.warn(`  ! ${href} is declared in font.css and not in src/font/ — text will fall back`);
}
```

> [!IMPORTANT]
> **If a generator writes into a linted tree, the generator owns the formatting.** This is the second
> instance in the repository — the first was the scaffold writing `JSON.stringify(…, null, 2)` and
> Biome re-inlining short arrays ([06](06-package-anatomy.md)). Both branches above were checked
> against Biome directly: three icons produce the inline form, twenty-seven produce the expanded one,
> and `biome check` reports no diff on either.

**One Biome override is required**, in `tooling/biome-config/src/base.json`:

```json
{
  "includes": ["packages/asset/src/icon/svg/**"],
  "linter": { "rules": { "a11y": { "noSvgWithoutTitle": "off" } } }
}
```

Sprite sources carry no `<title>` deliberately: the accessible name belongs on `ui`'s `<Icon>`, at
the call site that knows what the icon *means* there, and a `<title>` per `<symbol>` would put a
duplicated, context-free label in the DOM. `image/file/logo.svg` keeps its `<title>` and
`role="img"`, because that one **is** a standalone image. Scope the override to the sprite sources
and nowhere else.

### Why a sprite rather than components

**Every icon inherits `currentColor`**, so themes recolour the whole set with no per-theme variants and no JavaScript. `ui`'s `<Icon>` is four lines: `<svg><use href={sprite + "#" + name} /></svg>`.

**One HTTP request, cached forever.** Icon components mean every icon is JavaScript in your bundle, parsed on every page load.

**Adding an icon is dropping a file in `svg/`.** The registry regenerates, `IconName` gains a member, and a typo at a call site becomes a compile error.

**The hardcoded-colour check is the rule that earns its place.** One stray `fill="#333"` produces an icon that is invisible on a dark background, and nobody notices until a customer screenshots it. Failing the build is the only reliable moment to catch it.

---

## Step 19.3 — The image manifest

**`packages/asset/src/image/image.manifest.ts`**

```ts
import brandLogo from "./file/brand/logo.svg";
import homeHero from "./file/home/hero.webp";

export interface ImageAsset {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

const IMAGES = {
  "brand.logo": { src: brandLogo, width: 160, height: 40, alt: "Ratchet" },
  "home.hero": { src: homeHero, width: 1600, height: 900, alt: "Product dashboard" },
} as const satisfies Record<string, ImageAsset>;

export type ImageKey = keyof typeof IMAGES;

export class ImageManifest {
  private constructor() {}

  public static get(key: ImageKey): ImageAsset {
    return IMAGES[key];
  }

  public static keys(): readonly ImageKey[] {
    return Object.keys(IMAGES) as ImageKey[];
  }

  public static isKnown(value: string): value is ImageKey {
    return value in IMAGES;
  }
}
```

**The bundler fingerprints each import**, so `src` is a content-hashed URL you can cache forever and a file change invalidates automatically. The Tauri bundle ships the same files and serves them offline.

**`ImageKey` is a closed union.** A content record naming a missing image is a compile error today, and a validation error once content comes from a CMS.

**Dimensions live in the manifest** because layout shift is a real cost and `width`/`height` on an `<img>` is the fix. Storing them next to the file means they cannot drift from it.

Add a type declaration so TypeScript accepts the imports. It sits **above `src/`** — it emits
nothing and describes how the *bundler* resolves these specifiers, which makes it build tooling
rather than shipped code — so it has to be named in `include` or it is silently outside the program:

```json
// packages/asset/tsconfig.json
"include": ["src/**/*.ts", "src/**/*.tsx", "asset.d.ts"]
```

**`packages/asset/asset.d.ts`**

```ts
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.webp" {
  const url: string;
  export default url;
}
declare module "*.png" {
  const url: string;
  export default url;
}
```

---

## Step 19.4 — Fonts

**`packages/asset/src/font/font.css`**

```css
@font-face {
  font-family: "Inter";
  src: url("./inter-variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("./jetbrains-mono-variable.woff2") format("woff2-variations");
  font-weight: 100 800;
  font-style: normal;
  font-display: swap;
}
```

**Variable fonts, one file per family.** A static family needs six files for six weights; the variable version is one file covering the whole range and is usually smaller than three statics.

**`font-display: swap`** renders fallback text immediately rather than showing nothing while the font loads. The brief flash of unstyled text is better than a blank page, and it is what the metric you are eventually asked about measures.

**Self-hosted, never Google Fonts.** Third-party font CDNs are a privacy exposure, a GDPR question, a third-party outage in your critical path, and no faster than your own CDN under HTTP/2.

This file is imported exactly once, by `packages/ui/src/theme/token/typography.css` ([22](22-ui-package.md)).

> [!NOTE]
> **The two `.woff2` files are a drop-in, and the build says so on every run.** `build-sprite.mjs`
> checks each `src: url(…)` in this file against the directory and prints
> `fonts: 2 declared, 0 present`, naming what is missing.
>
> It **reports** rather than exiting non-zero, unlike the icon checks, and the asymmetry is the point:
> a missing font is visibly degraded to anyone looking at the page, so a loud line in the build log is
> proportionate. A hardcoded icon colour is invisible *except* in dark mode, which is exactly how it
> survives for weeks — so that one fails the build.

---

## Step 19.5 — The barrel

**`packages/asset/src/index.ts`**

```ts
export { ICON_NAMES, type IconName, IconRegistry } from "./icon/index.js";
export { type ImageAsset, type ImageKey, ImageManifest } from "./image/index.js";
```

`ICON_NAMES` is generated by `build-sprite.mjs` and `IconName` is derived from it, so both are on the list — `@loadbearing/ui`'s `Icon` needs the type and the permission matrix screen iterates the array.

---

## What changes when assets move to a CDN

Nothing above this package. `ContentSource.media(key)` currently reads `ImageManifest`; a `DbContentSource` would return a CDN URL for the same key. Content records hold `"home.hero"`, never a path, so the swap is one resolver — and it incidentally makes your logo swappable per tenant, which is worth more than it sounds for anything running client-branded portals.

**User uploads are not assets.** Receipts, avatars, resource-library files — those are domain data with permissions attached and they go through `StorageGateway` to S3 ([15](15-infrastructure-package.md)). This package holds only what the product ships with.

---

## ✅ Gate

```bash
pnpm --filter @loadbearing/asset build
```

- `src/icon/sprite.svg` exists with one `<symbol>` per file in `svg/`.
- `icon-registry.ts` regenerated with a matching `IconName` union, and **`pnpm check` reformats
  nothing** — if it does, the generator's two branches no longer match Biome.
- Adding an SVG containing `fill="#333"` **fails the build** with a clear message. So does one with
  no `viewBox`. Verify both by introducing them, the way [26](26-hygiene-and-ci.md)'s assertions are
  verified — and note that neither writes output, so a bad icon leaves the previous good sprite in
  place.
- `dist/` holds a content-hashed copy of every imported binary, which is the loader map working.

Do not proceed until this passes.

---

[← `@loadbearing/api-client`](18-api-client-package.md) · [`@loadbearing/content` →](20-content-package.md)
