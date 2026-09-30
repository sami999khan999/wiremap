---
title: "@loadbearing/content"
description: Every user-visible string, image reference, and structured record, split by locale and namespace so no runtime downloads words it cannot use. Three content shapes, each with a consumer.
---

# `@loadbearing/content`

The only package in this repository allowed to hold a sentence. `@loadbearing/errors` names failures
and carries structured context; `Error.message` there is the code. Every word a person actually reads
lives here, keyed and translated.

| | |
| --- | --- |
| **Package** | `@loadbearing/content` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `@loadbearing/errors` (type-only), `@loadbearing/asset`, `@loadbearing/permissions` (`ModuleKey`, type-only), `zod` |
| **Used by** | `composition`, `feature`, `apps/web`, `apps/worker` |
| **Environment** | isomorphic and **React-free** — the worker renders email copy with the same class the browser uses |
| **Build** | `tsup` → one chunk per locale × namespace, plus the entry |

> [!IMPORTANT]
> **This package was built in two passes, and the second one is done.** The error slice came first,
> out of order, because `@loadbearing/errors` has no other half — a code with no copy is a raw
> `SERVER_ONLY` rendered to a customer — and `ServerOnly.assert` in `core` throws before anything
> else in the repository runs. All four content shapes are now declared and implemented. Three items
> remain, each waiting on the app that calls it rather than on anything here; see
> [What exists](#what-exists-and-what-does-not).

```
packages/content/
├── vitest.config.ts               ← resolve.conditions: ["development"], for the errors import
├── src/
│   ├── index.ts                   ← the public barrel; names only folder barrels
│   ├── import.ts                  ← ErrorCode, ErrorEnvelope, FieldViolation from `errors`
│   ├── primitive/
│   │   ├── index.ts
│   │   └── locale.ts              → Locale, Locales
│   ├── translator/
│   │   ├── index.ts
│   │   ├── translator.ts          → Translator, MessageSnapshot
│   │   └── message-store.ts       → MessageStore; `ensure()` adds a namespace after first paint
│   ├── source/
│   │   ├── index.ts
│   │   ├── content-source.ts      → ContentSource (abstract) — all four shapes
│   │   └── static-content.source.ts → StaticContentSource
│   ├── media/                     ── shape 2: media references
│   │   ├── index.ts
│   │   ├── media-ref.ts           → MediaResolver, ResolvedMedia
│   │   └── static-media.resolver.ts → StaticMediaResolver
│   ├── collection/                ── shape 3: repeating records
│   │   ├── index.ts
│   │   └── nav/
│   │       ├── index.ts
│   │       ├── nav.schema.ts      → NavContract, NavItem
│   │       └── nav.data.ts        → navItems
│   └── message/                   ── shape 1: short keyed strings
│       ├── index.ts
│       ├── namespace.ts           → MessageKey, ShellMessageKey, NamespaceBundle, MessageParams
│       ├── catalog.ts             → CLIENT_CATALOG  (locale × namespace → loader)
│       ├── error-copy.ts          → ERROR_COPY, FIELD_RULE_COPY, ErrorCopy
│       ├── catalog.server.ts      → SERVER_CATALOG  (spreads the client one, adds `email`)
│       ├── en/                    ← as const; the key union is derived from these
│       │   ├── common.ts · error.ts · nav.ts · auth.ts
│       │   └── role.ts · member.ts · organization.ts · email.ts
│       └── bn/                    ← NamespaceBundle<N>; total, checked by tsc
│           └── the same eight
└── tests/
    ├── primitive/locale.spec.ts
    ├── translator/translator.spec.ts
    ├── source/
    │   ├── content-source.shapes.spec.ts
    │   └── static-content.source.spec.ts
    ├── media/static-media.resolver.spec.ts
    ├── collection/nav.data.spec.ts
    └── message/error-copy.spec.ts
```

---

## The four ideas

### 1. Copy splits by locale **and** by namespace

A key belongs to a namespace, a namespace loads as its own chunk, and a chunk is fetched for one
locale at a time. `CLIENT_CATALOG` is a `locale × namespace` grid of dynamic-import loaders, so a
browser reading English never downloads Bengali and never downloads the worker's email copy.

An earlier design merged every namespace into one frozen `en` object and derived the key union from
it. That object was load-bearing: `Translator` needed all of English resident, so every locale rode
into every bundle. **Merging was the bug.** [`namespace.ts`](reference/namespace.md) keeps the closed
key union and drops the merge, which works only because types are erased and runtime data is not.

### 2. The key union stays closed anyway

```ts
t("error.frobidden");   // compile error
```

`MessageKey` is derived from **type-only** imports of the English files. A typo at a call site is a
build failure, and `ERROR_COPY` is total over `ErrorCode` — even though the runtime data lives in
one chunk per locale × namespace that no module imports statically.

### 3. Two namespaces are guaranteed; everything else is lazy

`common` and `error` are the *shell*. `ContentSource.resolve()` unions them into every request, so a
route that declares `["auth"]` still gets working error copy and loading states. That is a property
of the seam, not a convention every call site remembers.

It is also why `ERROR_COPY` is typed `Record<ErrorCode, ShellMessageKey>` rather than
`Record<ErrorCode, MessageKey>` — an error code pointed at a lazy namespace would render as its own
raw key on the one screen that cannot afford a wiring bug.

### 4. Content references the security surface; it never defines it

Nav items will carry `module: "rbac"`, never `permission: "rbac.role.read"`. An editor can reorder a
menu; an editor cannot change what gates it. ESLint bans importing `PermissionKey` here, and
`nav.data.ts` is what makes the ban do work rather than pass vacuously.

---

## The error slice, end to end

```ts
// somewhere on the server
throw new ForbiddenError("task.reactivate", goalId);

// at the boundary
const envelope = ErrorNormalizer.normalize(thrown).toJSON();
// { code: "FORBIDDEN", context: { permission: "task.reactivate", goalId } }

// in the client, in the client's locale
const t = await content.translator(locale, []);
ErrorCopy.message(t, envelope);   // "You do not have permission to do that."
```

The server sent no prose, so there was no server-side locale negotiation for the API error, and a
desktop app running in a different language than the server is correct for free.

The sharpest case is the one that used to be an exception:

```ts
ServerOnly.assert("@loadbearing/infrastructure");
// ServerOnlyError: SERVER_ONLY   context: { package: "@loadbearing/infrastructure" }

ErrorCopy.message(t, error.toJSON());
// "@loadbearing/infrastructure was imported into a client bundle. This is a leak, not a bundle-size
//  problem — it means database or credential code is reachable from the browser."
```

That sentence used to be a string literal inside `ServerOnly.assert`, and it was the one error in the
repository permitted to carry a message. Moving it here cost nothing and removed the exception — see
[`errors`](../../errors/docs/index.md) and
[core's `ServerOnly`](../../core/docs/reference/server-only.md).

---

## What exists, and what does not

| Area | State |
| --- | --- |
| `locale.ts`, `translator.ts` | ✅ final |
| `message/en/*`, `message/bn/*` — `common`, `error`, `nav`, `auth`, `account`, `role`, `member`, `organization`, `apikey`, `document`, `doc`, `notification`, `platform`, `email` | ✅ fourteen namespaces per locale |
| `message/namespace.ts` | ✅ fourteen namespaces; `email` is `ServerNamespace`, outside `ClientNamespace` |
| `message/catalog.ts` | ✅ twenty-six cells, total over `Locale × ClientNamespace` |
| `message/error-copy.ts` | ✅ final |
| `content-source.ts`, `static-content.source.ts` | ✅ all four shapes declared and implemented |
| `media/` — `MediaResolver`, `StaticMediaResolver` | ✅ final |
| `collection/nav/` — `NavContract`, `navItems` | ✅ final |
| `message/catalog.server.ts` — `SERVER_CATALOG` | ✅ final; `Container` and `TestContainer` pass it to `StaticContentSource` |
| `translator/message-store.ts` — `MessageStore` | ✅ final; `apps/web/src/router.tsx` constructs it, `feature`'s `MessageProvider` reads it |
| `bundled-content.source.ts` — `BundledContentSource` | ☐ lands with a second shell — [30](../../../docs/setup/30-desktop-app.md), which is a plan |

**`SERVER_CATALOG` is what makes `Namespace` wider than `ClientNamespace`**, and the first thing
that makes `MessageCatalog` being `Partial` over `Namespace` do any work. It spreads
`CLIENT_CATALOG` and adds `email` — with **static** imports rather than `import()`, because a
dynamic specifier makes rollup emit a chunk that lands in the public assets directory even after the
catalog is tree-shaken out. `apps/web/src/router.tsx` constructs `new StaticContentSource()` with no
argument for exactly that reason; only
[`Container`](../../composition/docs/reference/container.md) passes the server one.

**Widening `Namespace` is additive.** `ShellNamespace`, `NamespaceKeys`, `MessageKey`,
`ShellMessageKey`, `NamespaceBundle`, `MessageBundle` and `MessageParams` are untouched by it, and no
consumer changes. That is what made building the error slice early safe rather than a down payment
on a rewrite.

> [!NOTE]
> **`"sideEffects": false` is load-bearing in this package**, not a kilobyte optimisation.
> `BundledContentSource` will statically import every locale, and `feature` imports `Translator`
> from the same barrel. Without the flag no bundler can prove the unused class is droppable, and the
> Bengali catalog rides into the client chunk through a barrel that never asked for it.

---

## Testing

55 tests.

```bash
pnpm --filter @loadbearing/content test
```

The ones worth knowing about:

- **Every `ErrorCode` resolves against a snapshot that asked for nothing.** `t.has(ERROR_COPY[code])`
  is `true` for all ten, built from `messages("en", [])`. This is what catches a code pointed at a
  lazy namespace once `ShellMessageKey` widens — the compiler cannot.
- **The `errors` seam round-trips.** `ServerOnlyError`'s sentence comes out whole, with `{package}`
  substituted. `errors` pins the context key from its side; neither package can see the other's half.
- **Every rule `ValidationError` can emit has copy** — driven from `ValidationError.fromIssues`
  rather than a hand-written list, so a new Zod issue mapping cannot slip past.
- **The shell arrives unasked**, and English rides alongside Bengali per namespace.
- **An unknown placeholder is left in place.** `"Hello {nmae}"` is obviously a bug;
  `"Hello undefined"` reads like a data problem and gets investigated in the wrong place.

---

## See also

- [namespace](reference/namespace.md) · [Translator](reference/translator.md) · [error-copy](reference/error-copy.md) · [ContentSource](reference/content-source.md)
- [Build order · 20 · content](../../../docs/setup/20-content-package.md)
- [`@loadbearing/errors`](../../errors/docs/index.md) — the codes these words are keyed to
