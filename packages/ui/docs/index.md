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
| **Entrypoint** | `src/index.ts` (opens with `"use client"`), plus `./style.css` |
| **Depends on** | `@loadbearing/asset`, the only runtime workspace dependency; `@base-ui/react` for behaviour, and `clsx` with `tailwind-merge` behind `cn` |
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
    ├── index.ts               ← "use client" on line 1; re-exports the four groups below
    ├── import.ts              ← every outside module, written once
    ├── component/             ← every exported component, one folder each
    │   ├── index.ts           ← names every component export
    │   ├── button/ … tooltip/ ← 26 folders, each with its own index.ts
    ├── theme/                 ← TypeScript only
    │   ├── theme-registry.ts  → ThemeRegistry, ThemeKey, ThemeMeta
    │   ├── mode-registry.ts   → ModeRegistry, ModeKey, ModePreference
    │   ├── font-registry.ts   → FontRegistry, FontKey, FontMeta
    │   └── theme-scope.tsx    → ThemeScope, usePortalContainer
    ├── style/                 ← every stylesheet, and nothing else
    │   ├── index.css          ← the one entry, exported as `./style.css`
    │   ├── token.css          ← the sizes, as Tailwind theme blocks
    │   ├── color/*.css        ← one per theme; the twelve names, in oklch
    │   ├── tailwind.css       ← the twelve as Tailwind's palette; the `dark` variant
    │   ├── base.css           ← the page, the focus ring, the skip link
    │   └── markdown/*.css     ← callout, card, code-block, prose
    ├── class-name/            → cn
    └── format/                → DateFormat, ByteFormat
```

**Four groups, each answering one question.** `component/` is what a caller renders, one folder per
exported component. `theme/` is how a theme is chosen and scoped. `style/` is what the page looks
like where no component's utilities reach. `class-name/` and `format/` are the two helpers every
component may use. `ui` is the third folder shape in the repository, neither role-organised nor
subject-organised ([Folders](../../../docs/opinions/folders.md)).

## The stylesheets, and what each may reference

Components style themselves with Tailwind utilities, so `style/` holds only what a utility cannot
express. The rule reads in one direction:

| File | Holds | May reference |
|---|---|---|
| `token.css` | sizes — type, space, radius, shadow, motion | nothing |
| `color/*.css` | one file per theme; the twelve colour names | nothing |
| `tailwind.css` | the twelve as Tailwind colours, and `dark:` | `color/`, only as `var()` |
| `base.css`, `markdown/*.css` | the page, and HTML the Markdown renderer writes | the rest, only as `var()` |

`token.css` names no colour — **a dark theme is not a different spacing system**. A colour file
names no component. `base.css` and `markdown/` declare no literal value of their own: a hex there is
a token that was never added, and `check-architecture` §32 fails on it. `markdown/` exists because
stored doc HTML carries `ui-callout`, `ui-card` and `ui-prose`, and React never renders it, so no
utility can reach it.

`style/index.css` is Tailwind source, never linked alone. The app's entry,
[`apps/web/src/style/app.css`](../../../apps/web/src/style/app.css), imports it as
`@loadbearing/ui/style.css` and compiles it with the utilities into one stylesheet. `base.css` and
`markdown/` sit in the `components` layer, so a utility passed in `className` beats them.

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

## Behaviour comes from Base UI

Rule 4 says to use a headless library for anything with hard interaction semantics, and that
library is [Base UI](https://base-ui.com) (`@base-ui/react`), one line in the React-scoped group
of the catalog. It owns focus traps, inert backgrounds, restored focus, `Escape`, dismissal,
roving focus and ARIA. This package owns the markup's styling and the props.

| Component | Base UI part | What it took over |
| --- | --- | --- |
| `Popover` | `Popover` | Escape, outside press, focus in and back, trigger ARIA |
| `Select`, `Menu` | `Select` | the listbox: arrows, Home and End, typeahead, a hidden input for forms |
| `ThemeToggle` | `RadioGroup` | a real radio group, with arrow keys and one tab stop |
| `CommandDialog` | `Dialog` | the modal trap, the inert page, Escape, focus return |
| `Dialog`, `AlertDialog` | `Dialog`, `AlertDialog` | as above; an alert dialog starts on Cancel and ignores the backdrop |
| `Tooltip` | `Tooltip` | hover and focus delays, Escape, the description link |

Three stayed hand-written, each for a stated reason:
- **`Field`** has no interaction to take over. Base UI's `Field` would also require its own
  control inside, which every native control would then have to become.
- **`Sidebar`'s drawer** is one element that is a column on a wide screen, and Base UI's `Dialog`
  renders only while open, in a portal.
- **`CommandDialog`'s result list** follows the caller's router link on Enter, which is not
  a select.

**A portal leaves a nested theme.** A panel opened inside the doc reader would paint in the page's
theme, so [`ThemeScope`](../src/theme/theme-scope.tsx) renders the scoped `data-theme` and
hands its element to every portal inside it. See [Popover](reference/popover.md).

**Every scrollbar is one component.** `PageScrollbar`, mounted once at the root, replaces the
page's bar with a glass overlay and themes every inner scroller to match, from the twelve tokens.
See [Scrollbar](reference/scrollbar.md).

**No Storybook, and no `*.stories.tsx`.** Doc 22 offers Storybook or a `/kitchen-sink` route in
`apps/web` and says to pick one deliberately. The route is what was picked —
`apps/web/src/route/(dev)/kitchen-sink.tsx` renders every component against every theme and every
mode, with no second build, no second dependency tree and no story files to keep in step with the
components. `Can` is the exception and has nothing to show: it renders no element of its own.
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

**No third-party design system; Tailwind for styling, Base UI for behaviour.** Every component
carries a `ui-*` class, and those class names are the contract that specs and callers select on.
Each component writes its Tailwind utilities itself, through
[`cn`](../src/class-name/class-name.ts), with its `ui-*` hook first and carrying no styles. A caller's
`className` wins a conflict, because `cn` merges and drops the losing utility.

## Testing

```bash
pnpm --filter @loadbearing/ui test
```

This is the first package in the repository that needs a DOM. `vitest.config.ts` sets
`environment: "jsdom"`, and `vitest.setup.ts` runs `afterEach(cleanup)` — **not optional with
`globals: false`.** `@testing-library/react` registers that hook itself only when vitest runs with
globals; without it a second `render` in the same file leaves the first mounted, and the symptom is
`getByText` failing with "found multiple elements" in a test that reads correctly.
