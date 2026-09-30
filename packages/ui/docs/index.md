---
title: "@loadbearing/ui"
description: The design system — structural tokens, themes as custom properties, and components that take props and nothing else. No domain nouns, no router, no cache.
---

# `@loadbearing/ui`

Two rules define this package, and both are mechanical.

**A domain noun in an export name means the component is in the wrong package.** `StatusBadge` is
here; its domain-named wrapper is `feature`. `DataTable` is here; a table that knows what it is
listing is `feature`. The moment a component knows the domain, it cannot be restyled without
understanding the domain and cannot be tested without domain fixtures.

**If a component needs the router, it belongs in `apps/web`.** Navigation arrives as an `onNavigate`
prop or an `href` string. That is what lets the Tauri webview mount these components under a
different routing shell.

| | |
| --- | --- |
| **Package** | `@loadbearing/ui` (private, never published) |
| **Entrypoint** | `src/index.ts` (opens with `"use client"`), plus `./theme.css` and `./class.css` |
| **Depends on** | `@loadbearing/asset` — **the only runtime workspace dependency** |
| **Type-only** | `@loadbearing/permissions`, a `devDependency` because both imports are erased |
| **Peers** | `react`, `react-dom` |
| **Used by** | `feature`, `apps/web` |

```bash
grep -rn "@tanstack\|@loadbearing/query\|@loadbearing/contracts" packages/ui/src
```

Returns nothing.

```
packages/ui/
├── ui.d.ts                    ← declare module "*.svg"; named in tsconfig `include`
├── vitest.setup.ts            ← afterEach(cleanup)
└── src/
    ├── index.ts               ← "use client" on line 1
    ├── import.ts              ← two workspace entries, both type-only but one
    ├── theme/
    │   ├── theme.css          ← entry: @imports token/ and color/
    │   ├── class.css          ← entry: @imports class/. A separate export
    │   ├── token/*.css        ← typography, space, radius, shadow, motion
    │   ├── color/*.css        ← one per theme; the twelve names, in oklch
    │   ├── class/*.css        ← one per component; styles the ui-* hooks
    │   ├── theme-registry.ts  → ThemeRegistry, ThemeKey, ThemeMeta
    │   ├── mode-registry.ts   → ModeRegistry, ModeKey, ModePreference
    │   └── font-registry.ts   → FontRegistry, FontKey, FontMeta
    ├── button/…               → Button, ButtonVariant
    ├── card/…                 → Card, CardGrid
    ├── code-block/…           → CodeBlock
    ├── command-dialog/…       → CommandDialog, SearchTrigger, useHotkey
    ├── callout/…              → Callout, CalloutTone
    ├── can/can.tsx            → Can
    ├── code-list/…            → CodeList
    ├── data-table/…           → DataTable, DataTable.Skeleton
    ├── empty-state/…          → EmptyState
    ├── field/…                → Field
    ├── format/…               → DateFormat
    ├── icon/icon.tsx          → Icon
    ├── input/…                → Input
    ├── menu/…                 → Menu
    ├── nav-tree/…             → NavTree, LinkAttributes
    ├── prose/…                → Prose
    ├── qr-code/…              → QrCode
    ├── sidebar/…              → Sidebar
    ├── status-badge/…         → StatusBadge, BadgeTone
    ├── theme-toggle/…         → ThemeToggle
    ├── toc/…                  → Toc
    └── zone/…                 → Zone, ZoneItem
```

One folder per exported component, which is the third folder shape in the repository —
`ui` is neither role-organised nor subject-organised ([Folders](../../../docs/opinions/folders.md)).

## Three folders, and one rule about which is which

`theme/` divides by what a file is allowed to reference, and the rule reads in one direction:

| Folder | Holds | May reference |
|---|---|---|
| `token/` | sizes — type, space, radius, shadow, motion | nothing |
| `color/` | one file per theme; the twelve colour names | nothing |
| `class/` | one file per component; the `ui-*` rules | `token/` and `color/`, only as `var()` |

`token/` names no colour — **a dark theme is not a different spacing system**. `color/` names no
component. `class/` declares no literal value of its own: a hex or a pixel appearing there is a
token that was never added. A rule in the wrong folder is visible from its content alone.

`token/` and `color/` ship together as `./theme.css`; `class/` ships as `./class.css`, so an app
that wants the tokens and its own design drops one link and keeps the rest.

## A theme and a mode are two axes

`<html data-theme="ocean" data-mode="dark">`. The palette is one attribute and light-or-dark is
another, so a mode toggle keeps the palette and a palette that ships only one mode declares only one
block. `ThemeMeta.modes` says which, and `ThemeRegistry.resolveMode` is what stops a dark-only
palette being asked for a light block it does not have — a pair that matches no selector is a page
with every colour undefined.

## Twelve names, and every theme declares all twelve

```css
--bg  --surface  --muted  --border  --fg  --fg-muted
--primary  --primary-fg  --success  --warning  --danger  --ring
```

The set is the contract rather than a starting point: a theme that omits one inherits whatever the
`:root` seed left behind, which is a colour from a different theme. Every value is `oklch()`, which
makes a hue rotation a real operation — the other themes are slate's lightness ladder at another
hue, with chroma capped to what sRGB can hold there.

See [Palette](reference/palette.md) for the twelve, the gamut trap, and how to add a theme.

Adding a theme is one CSS block and one registry entry — no re-render, no provider, no class-name
churn. And because every icon uses `currentColor` ([`asset`](../../asset/docs/index.md)), a theme
recolours the entire icon set with no per-theme variants.

**Applying a preference is two calls, and the second is the one people forget:**

```ts
root.dataset.theme = key;   // ThemeRegistry.apply
root.dataset.mode = mode;   // ModeRegistry.apply, which also sets
root.style.colorScheme = mode;
```

Each registry moves only its own axis, so switching palette never disturbs the mode. `colorScheme`
belongs to `ModeRegistry` because it is a property of light-or-dark rather than of the palette, and
it is what makes native scrollbars, form controls and date pickers match — without it a dark theme
has light scrollbars. Call both before hydration, from a tiny inline script in `<head>` reading the
stored preference, or a dark-mode reader gets a white flash on every load.

**A palette need not ship both modes, which is why `resolveMode` exists.** `midnight` declares
`modes: ["dark"]`; asked to render light it would match no selector at all, so
`ThemeRegistry.resolveMode(key, wanted)` is what stops that pair reaching the DOM.

`FontRegistry` is the same shape one level down: it overrides the `--font-sans` custom property
rather than restyling anything, so one line changes the whole system. Reading font choice as a token
override rather than a theme is what keeps the two independent — a reader can pick a serif face
without also picking a colour scheme.

**Both registries guard with `Object.hasOwn`, not `in`.** These are the boundaries an untrusted
stored preference crosses, so `"toString"` passing the guard would make `meta()` hand back a
function. The same bug the permission catalog had, and the specs pin it.

## `<Can>` is a convenience, never the gate

```tsx
<Can permission="rbac.role.read" capabilities={caps} fallback={null}>…</Can>
```

It calls the same `CapabilitySet.can()` the server calls — **one implementation used by both**, not
two that agree today. That identity is the entire point of
[`permissions`](../../permissions/docs/index.md), and a spec asserts the component's answer and a
direct call are the same answer.

Hiding a button is a UX affordance. The real check is `Authorizer.assert()` in the use-case, and it
runs whether or not the button was ever rendered.

> [!NOTE]
> **`goalId` is the one apparent domain noun in this package, and it is not one.** It forwards a
> permission *scope* id to `CapabilitySet.can(permission, goalId?)` under that method's own parameter
> name. "Goal" is a tier in the authorization model here, not an entity `<Can>` knows about — and
> renaming the prop would hide the pass-through behind a word nobody can grep for. Doc 22's
> domain-noun gate excludes `src/can/can.tsx` for exactly this, and nothing else.

## `<Zone>` takes items, not children

```tsx
<Zone label="Dashboard" items={[{ key: "member.count", title: "Members", content: <Count /> }]} />
```

A zone is where a page puts units side by side: a labelled region, and one card per item with a
title and an optional action in its header. It knows nothing about who may see a unit or why one is
missing. That is decided before the items reach it.

**`items` rather than `children` is the point.** A child list would accept anything, including a
`<Can>` dropped in beside the units, which is the one shape the visibility rules forbid: `<Can>`
gates an affordance *inside* a unit, never a unit. With `items`, that shape cannot be written, and
no lint rule has to catch it.

No items renders `empty` inside the same labelled region, or nothing when there is no `empty` — never
an empty grid, which reads as broken. The grid is `auto-fill` on the space tokens, one column on a
phone, and colours come only through the twelve names.

## Five rules for every component here

1. **Props in, markup out.** No fetching, no context beyond theme, no global state.
2. **Every string is a prop.** No literals anywhere — copy lives in
   [`content`](../../content/docs/index.md) and reaches these components through `feature`, which is
   what keeps the design system translatable and testable with props alone.
3. **Keyboard and focus, always.** `DataTable`'s clickable row carries `tabIndex`, `role="button"`
   and an `Enter`/`Space` handler, and those three move together or not at all — a row that responds
   to a mouse and not to a keyboard is the most common accessibility bug in a data table.
4. **Headless primitives for anything with hard interaction semantics.** Which is why there is no
   `Dialog` — see below.
5. **A control is associated with the words written about it.** `Field` computes a `-hint` and an
   `-error` id, puts them on the paragraphs **and clones its child** with `aria-describedby` and
   `aria-invalid`. Computing the ids and pointing nothing at them is markup that reads as accessible
   in a diff and announces nothing — every form in `feature` inherited exactly that. The child's own
   `aria-describedby` is joined rather than replaced, because the attribute is a list.

## Three things this package does not have

**No `Dialog`.** A dialog needs a focus trap, an inert background, restored focus on close, `Escape`
handling and correct `aria-modal` semantics. Hand-rolling it is what rule 4 forbids, so it waits on a
headless library — Radix or Ark — which is a package that lands in the client bundle of every
consumer and therefore a decision, not a file. One catalog line in the React-scoped group plus one
wrapper here when that is made. A dialog that traps focus incorrectly is worse than one that does not
exist, because the first ships.

**`CommandDialog` is not the exception either.** It is the native `<dialog>` opened with
`showModal()`, and the browser supplies the trap, the inert background and Escape. That is a headless
primitive that ships in every engine rather than in the bundle. See
[Documentation primitives](reference/docs-primitives.md).

**`Popover` is not the exception to that**, and the distinction is worth stating because the two
look alike. A popover is non-modal: the page behind it stays live, Tab moves out of it, and
nothing is inerted. There is no trap to get wrong, which is exactly why one could be written here
and a dialog could not. See [Popover](reference/popover.md) for what it deliberately is not, and
for why it is React state rather than the native `popover` attribute.

**No Storybook, and no `*.stories.tsx`.** Doc 22 offers Storybook or a `/kitchen-sink` route in
`apps/web` and says to pick one deliberately. The route is what was picked —
`apps/web/src/route/(dev)/kitchen-sink.tsx` renders eleven of the twelve components against every
theme and every mode, with no second build, no second dependency tree and no story files to keep in
step with the components. `Can` is the twelfth and has nothing to show: it renders no element of
its own.
The component tests under `tests/`, on `jsdom` and `@testing-library/react`, are the other half: they
assert *behaviour* where the route shows *appearance*.

> [!IMPORTANT]
> **`(dev)` is a route group, not a build condition.** It organises files and contributes nothing to
> the URL, so nothing about the directory name kept this page out of a production bundle — it was a
> public route that any visitor could open. The route's loader now throws `notFound()` unless
> `import.meta.env.DEV`, and `apps/web/tests/route/kitchen-sink.spec.ts` pins both directions.
>
> Its labels are English literals and stay that way. A page that cannot render in production has no
> users, so there is no user-visible copy for [`content`](../../content/docs/index.md) to own —
> adding a `dev` namespace to `ClientNamespace`, `NamespaceShape` and two catalog cells would be
> structure built for nobody to read.

**No third-party design system.** Every component carries a `ui-*` class, and those class names are
the contract: `theme/class/*.css` is what they resolve to, exported separately from `theme.css` so a
consumer can take the tokens and write its own look. Eleven of the twelve components have a
stylesheet there; `Can` renders no element of its own. Keeping the hooks and the styling in two files is what
makes a design pass a rewrite of one directory rather than of every component.

## Testing

```bash
pnpm --filter @loadbearing/ui test
```

This is the first package in the repository that needs a DOM. `vitest.config.ts` sets
`environment: "jsdom"`, and `vitest.setup.ts` runs `afterEach(cleanup)` — **not optional with
`globals: false`.** `@testing-library/react` registers that hook itself only when vitest runs with
globals; without it a second `render` in the same file leaves the first mounted, and the symptom is
`getByText` failing with "found multiple elements" in a test that reads correctly.
