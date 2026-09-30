---
title: Sprite build
description: The two checks that fail the build, why the generated registry has to match Biome's formatter exactly, and why the sprite is gitignored while the registry is committed.
---

# `build-sprite.mjs`

Runs as `prebuild`, so `pnpm --filter @loadbearing/asset build` cannot produce a package whose
registry disagrees with the files on disk. It reads `src/icon/svg/*.svg` and writes two files.

| Output | Committed? | Why |
| --- | --- | --- |
| `src/icon/sprite.svg` | **no**, gitignored | Every icon addition would be a merge conflict in a file nobody reads |
| `src/icon/icon-registry.ts` | **yes** | `tsc --noEmit` and every consumer's typecheck need `IconName` without running a build first |

That split is the interesting part. The sprite is pure output; the registry is output that the type
system depends on. Gitignoring both would mean a fresh clone cannot typecheck, and committing both
would mean two conflict-prone generated files instead of one.

## The two checks that fail the build

Both were verified the way `check-architecture.mjs`'s assertions were — by introducing the violation
and watching the build exit non-zero. Do not "tidy" either without re-testing that it still catches.

**1. A hardcoded `fill` or `stroke`.**

```js
if (/(fill|stroke)=["'](?!none|currentColor)[^"']+["']/.test(raw)) { … }
```

This is the rule that earns its place. One stray `fill="#333"` produces an icon that is invisible on
a dark background — and *only* on a dark background, which is why nobody notices until a customer
sends a screenshot. Failing the build is the only reliable moment to catch it, because every later
moment requires somebody to be looking at the right theme.

`none` and `currentColor` are the two legitimate values. `none` is how an outline icon says "do not
paint the interior"; `currentColor` is what makes the whole set inherit the surrounding text colour.

**2. A missing `viewBox`.**

A `<symbol>` without one has no coordinate system, so it renders at whatever size the first `<use>`
happens to imply — which differs per call site, silently, and looks like a CSS bug.

Both checks collect into a `problems` array and report **all** of them before exiting, rather than
stopping at the first. Fixing icons one build at a time is the kind of loop that makes people
disable the check.

**Neither check writes anything on failure.** The process exits before `writeFileSync`, so a bad
icon leaves the previous good sprite and registry in place rather than half-updating them.

## The generated registry must match Biome's formatter exactly

```js
const inline = `export const ICON_NAMES = [${names.map((n) => `"${n}"`).join(", ")}] as const;`;
const declaration = inline.length <= 100 ? inline : /* one entry per line */;
```

Biome collapses an array literal onto one line when it fits inside `lineWidth` (100) and expands it
one entry per line when it does not. A generator that always emits the expanded form produces a file
that `pnpm check` immediately reformats — so **every icon addition shows up twice**: once as the
generated change, once as a formatting change, in a file marked "do not edit".

Both branches were checked against Biome directly: three icons produce the inline form, twenty-seven
produce the expanded one, and `biome check` reports no diff on either.

This is the same class of problem as the scaffold writing `JSON.stringify(…, null, 2)` and Biome
re-inlining short arrays. **If a generator writes into a linted tree, the generator owns the
formatting.**

## Names are sorted

`readdirSync(...).sort()`, and a spec asserts the registry is sorted. Directory order is not
guaranteed across platforms, so without the sort the same icon set produces a different registry on
Linux and on Windows — a diff that appears and disappears depending on who ran the build.

Sorted also means adding an icon is a one-line diff rather than a reshuffle.

## Why a sprite rather than icon components

**Every icon inherits `currentColor`.** A theme recolours the entire set with no per-theme variants
and no JavaScript. `ui`'s `<Icon>` is four lines.

**One HTTP request, cached forever.** Icon components put every icon into the JavaScript bundle, to
be parsed on every page load whether or not the page renders it. A sprite is one file the browser
caches and the page references by fragment.

**Adding an icon is dropping a file.** No import to add, no component to write, no barrel to update —
and `IconName` gaining a member means a typo at a call site is a compile error rather than an empty
box.

The cost is that `<use href="…#name">` needs the sprite URL, which is why `./sprite.svg` is a package
entrypoint. That is a real trade and it buys the three properties above.

## What the specs pin

`tests/icon/icon-registry.spec.ts` reads `src/icon/svg/` at runtime and asserts `ICON_NAMES` equals
it. **That is the assertion worth having**: it catches somebody adding an icon and committing without
running the build, which is the one failure this generator's design makes possible.

The sprite assertions are the same shape — one `<symbol>` per registered name, a `viewBox` on each,
no hardcoded colour anywhere in the output. The colour rule is checked on the *output* as well as the
input, so a change to the body extraction that let one through still fails.
