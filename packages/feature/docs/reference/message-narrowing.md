---
title: Message narrowing
description: Why useMessages takes the namespace as its only argument, why the two-argument shape that looks equivalent constrains nothing, and why a missing key renders as itself.
---

# `useMessages`

```tsx
const { t } = useMessages("auth");
```

One argument, and the whole design turns on it.

## The shape that looks equivalent and is not

The obvious API is two arguments — namespace and key, together:

```ts
declare function t<N extends string>(ns: N, key: Extract<MessageKey, `${N}.${string}`>): string;

t("auth", "error.forbidden");   // compiles. The constraint is decorative.
```

It compiles because **the key position is also an inference site.** TypeScript solves for `N` using
*both* arguments, so `N` widens until the pair is consistent — here to something that admits
`"error.forbidden"`. The constraint reads like a rule and enforces nothing.

`useMessages("auth")` fixes `N` from a single position, before any key exists. The returned `t` then
has a concrete parameter type — `NamespaceKeys["auth"] | NamespaceKeys[ShellNamespace]` — and an
indexed access into a mapped type is **not** an inference site, so it rejects rather than widens.

That is why `Translator.t` in [`content`](../../../content/docs/index.md) keeps a flat `MessageKey`
and *all* narrowing happens here: this is the only place that knows the namespace statically.

> Verified both ways against this repo's compiler flags. If `t("nav.roles")` ever compiles from a
> component that declared `"auth"`, someone has replaced the mapped type with a template-literal
> `Extract` and the constraint has gone back to being decorative.

## Why the shell is always in the union

```ts
type ScopedKey<N extends ClientNamespace> = NamespaceKeys[N] | NamespaceKeys[ShellNamespace];
```

`t("action.cancel")` and `t("error.forbidden")` work from an auth screen that declared only `"auth"`.
That is not a convenience carve-out — it is the type saying exactly what the runtime guarantees:
`ContentSource.resolve()` is `protected static` and every implementation runs its request through it,
so `common` and `error` are in **every** snapshot, from every source, including a future
`DbContentSource`.

A component's key union and the snapshot it will actually receive are therefore the same set. That
identity is the point; widening either one alone breaks it.

## `email` is unreachable, twice over

`N extends ClientNamespace`, and `email` is a `ServerNamespace`. So the namespace argument rejects it
before any key is written — the type system closes the door, and the ESLint ban on importing the
server catalog is a second lock on it.

Worth noting the layering: the type check is what makes the mistake unwriteable, and the lint rule is
what makes it unwriteable *by a different route* (importing the catalog directly). Neither is
redundant.

## A missing key renders as itself

```
nav.roles
```

on screen, rather than an exception or a silent fallback to English. Both alternatives are worse in
different directions:

- **Throwing** takes down an otherwise healthy page over a forgotten one-line namespace declaration.
- **Falling back to English** ships the bug silently, to be discovered by a Bengali customer.

Rendering the key is loud, local, and names the exact string to grep for — and it tells you the real
fault, which is a route that did not declare a namespace, not a missing translation.

**The error and loading paths cannot reach that branch**, which is what makes the choice safe:
`error.*` and `action.*`/`state.*` are shell keys, always present. A raw key can only ever surface in
feature copy, which is exactly where a missing declaration is.

## Why `useSyncExternalStore`

A snapshot is immutable, but client-side navigation adds namespaces after the provider mounted. The
store is subscribed **once**, at the provider; `useMessages` stays a plain `useContext` read.

```ts
const read = useCallback(() => messages.translator, [messages]);
```

`MessageStore.translator` returns a stable identity until `ensure()` genuinely adds something. That
is not an optimisation — `useSyncExternalStore` compares the read result by reference on every
render, so a store that minted a fresh `Translator` per call would re-render forever. The stability
is a contract between the two files, and it is the reason `MessageStore` caches `cached` alongside
`snapshot` rather than constructing on demand.

## Where the snapshot comes from

Server-side, inlined into the SSR payload, so the correct locale is in the first rendered byte.
Fetching translations client-side means either a flash of English or a blocking request before
anything renders — and on a slow connection the flash is long enough to read.

`MessageStore.dehydrate()` / `restore()` are the two halves of that crossing, and `apps/web`'s route
loader is what calls `ensure()` when a navigation needs a namespace the current snapshot lacks.
