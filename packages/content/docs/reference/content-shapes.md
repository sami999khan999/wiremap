---
title: The four content shapes
description: Why media and nav are separate shapes rather than one — and the rule that keeps a content edit from becoming a privilege escalation.
---

# Media and collections

`ContentSource` declares three shapes because they have three different edit models, three different
validation stories, and four different answers to "what happens when this moves to a CMS".

| Shape | Folder | Who edits it | Validated by |
| --- | --- | --- | --- |
| Keyed strings | `message/` | a translator, per locale | the `MessageKey` union, at compile time |
| Media references | `media/` | nobody — a key resolves to a manifest entry | `ImageKey`, at compile time |
| Repeating records | `collection/` | a content editor | Zod, at module load |

## The rule: content references the security surface, it never defines it

```ts
{ module: "rbac", labelKey: "nav.roles", icon: "check", order: 10 }
```

`module: "rbac"`, **not** `permission: "rbac.role.read"`. `ModuleRegistry` in
[`permissions`](../../../permissions/docs/index.md) maps that key to its gate and its route.

An editor can reorder the menu, rename items, and change icons. An editor **cannot** change what
gates a module or point a label at a different route. If the permission were a content field, a CMS
edit would be a privilege escalation — and that is exactly the kind of vulnerability that gets found
by accident, years later, by somebody looking at something else.

Three things enforce it, in increasing order of how early they catch you:

1. **ESLint** bans the two symbols that would let this package name a permission, in
   `tooling/eslint-config/src/index.js`. The ban is scoped to `packages/content/src/**`, and
   `ModuleKey` is deliberately not on it.
2. **`NavRecord`** in `nav.data.ts` types `module` as `ModuleKey`, so a menu entry naming a module
   that does not exist fails to compile.
3. **A spec** asserts every `navItems` entry's module is a key of `GATES`, its icon is in the sprite,
   and its label key has copy behind it — the checks that survive the day these rows come from a
   database and the compiler stops helping.

> [!NOTE]
> The gate in [20](../../../../docs/setup/20-content-package.md) greps this tree for the banned
> symbol names, so a **comment** mentioning one fails it. Doc 20's own suggested comment on
> `nav.schema.ts` does exactly that; the version on disk is reworded to say the same thing without
> the literal.

## Two types for one record, and why

`nav.schema.ts` types `module`, `labelKey` and `icon` as `z.string()`. `nav.data.ts` declares a
narrower `NavRecord` and pins the literal against it with `satisfies`:

```ts
const ITEMS = [...] as const satisfies readonly NavRecord[];
export const navItems: readonly NavItem[] = NavContract.collection.parse(ITEMS);
```

Both checks run, and they are checking different things.

**`satisfies NavRecord` is the authoring check.** While the data is a literal in this repository,
a bad module key, an icon that is not in the sprite, or a label with no copy behind it should be a
build failure — not something a test finds later.

**`NavContract.collection.parse` is the boundary check.** It is what will still be true when these
records arrive as rows from a database, where TypeScript knows nothing. Keeping the schema wide is
the point: narrowing it to the unions would make the schema unable to parse the untrusted input it
exists to parse.

That is also why the two types are not merged. `NavItem` describes *any* nav record, including one a
CMS just produced. `NavRecord` describes the ones this repository authors.

## Media is async in the seam and synchronous in the implementation

```ts
public abstract media(key: ImageKey): Promise<ResolvedMedia>;
```

`StaticMediaResolver` answers from a manifest that is already in the bundle, so `StaticContentSource`
returns `Promise.resolve(...)` from a plain method rather than being `async` with nothing to await —
`require-await` rejects the second, and it would claim an asynchrony the method does not have.

The seam stays async because a CMS resolves this over the network. A signature that changed for the
CMS would change every call site, which is the cost this abstraction exists to avoid.

`ImageKey` is imported **type-only**, so `content` gets `asset`'s vocabulary without pulling its
binaries into the worker's bundle. `ImageManifest` is a value import and reaches only
`StaticMediaResolver`.

## There is no `document()` shape, and there was

Long-form editorial was declared as a fourth shape: `document(slug)` on the source, a
`DocumentContract` and a `DocumentEntity` to parse a row that no adapter ever returned. Nothing
called it, `StaticContentSource` answered `null` for every slug, and the argument for keeping it —
"this is precisely the shape that exists to come from a database" — is an argument for building it
*with* that database rather than before one.

It was deleted. Re-adding it is one abstract method, one implementation and one contract, which is
the same cost it was carrying while doing nothing. What the deletion buys is that every method on
`ContentSource` now has a caller, so a reader can tell the declared shapes from the aspirational
ones without reading the adapter.

