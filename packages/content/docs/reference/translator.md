---
title: Translator
description: Translator and MessageSnapshot — one immutable shape that is the constructor argument, the SSR wire format, and the merge unit, plus twelve lines of interpolation and no i18n library.
---

# `Translator`, `MessageSnapshot`

```ts
export interface MessageSnapshot {
  readonly locale: Locale;
  readonly namespaces: readonly Namespace[];
  readonly base: MessageBundle;        // English, loaded namespaces only — the fallback layer
  readonly overrides: MessageBundle;   // the requested locale; empty when locale is "en"
}

export class Translator {
  public constructor(private readonly snapshot: MessageSnapshot) {}

  public get locale(): Locale;
  public loaded(namespace: Namespace): boolean;
  public t(key: MessageKey, params?: MessageParams): string;
  public has(key: MessageKey): boolean;
  public with(overrides: MessageBundle): Translator;
  public static merge(a: MessageSnapshot, b: MessageSnapshot): MessageSnapshot;
}
```

---

## One shape, three jobs

`MessageSnapshot` is the constructor argument, the JSON that crosses the SSR boundary, and the merge
unit for client-side navigation. One shape, three jobs, no adapters between them.

**`base` is deliberately not a total `Record<MessageKey, string>`.** A total record is precisely what
forced all of English to be resident, and with it every locale into every bundle
([namespace](namespace.md#types-are-erased-runtime-data-is-not)). A snapshot covers the namespaces
actually loaded, and `namespaces` records which those are.

**Two layers, not one merged bundle.** `overrides` wins per key, `base` answers the rest. That is what
makes a `Partial` locale safe: `bn/error.ts` translating four keys out of twelve is a finished,
shippable state rather than eight holes.

---

## `t()` — interpolation, and the two loud failures

```ts
t("error.field.tooShort", { field: "Reason", min: 10 });
// "Reason must be at least 10 characters."
```

`{name}` replacement, twelve lines, no library. ICU MessageFormat handles plurals and gender properly
and is the right answer when you need them; until then a `String.replace` has no dependency, no bundle
cost and no learning curve. Swapping later is a change inside this one class, because every call site
goes through `t()`.

`params` is [`MessageParams`](namespace.md#messageparams), which allows `boolean` — the same shape as
`ErrorContext`, so an error envelope's context passes straight through.

### An unknown placeholder is left in place

```ts
t("error.field.required", { fiedl: "Email" });   // "{field} is required."
```

Not `"undefined is required."` `"Hello {nmae}"` on screen is unmistakably a bug in the call site;
`"Hello undefined"` reads like a data problem and gets investigated in the wrong place.

### A missing key renders as the key

```ts
t("auth.signIn");   // "auth.signIn"  — that namespace was never loaded
```

Same principle. Seeing `auth.signIn` on screen names the exact string to grep for, and the bug is
always the same one: a route that forgot to declare a namespace. The alternatives are worse in both
directions — throwing takes down an otherwise healthy page over a one-line omission, and falling back
to English ships the bug silently, to be discovered by a Bengali customer.

**Make the failure loud and local, never plausible.**

> [!NOTE]
> **The error path and the loading path cannot reach that branch.** `error.*` and
> `action.*`/`state.*` live in the shell namespaces, which every `ContentSource` puts in every
> snapshot ([ContentSource](content-source.md)). A raw key can only surface in feature copy, which is
> where a missing declaration actually is. `ERROR_COPY` is typed to keep it that way
> ([error-copy](error-copy.md#the-value-type-is-shellmessagekey-and-that-is-load-bearing)).

---

## `with()` is immutable, `merge()` is a union

```ts
const forRecipient = shared.with({ "email.greeting": "Hi {name}," });
```

Per-recipient composition in the worker builds on a shared instance without mutating it — which is
the difference between a digest job that is safe to parallelise and one that is not.

```ts
Translator.merge(current, added);   // namespaces deduplicated, both layers merged
```

`merge` is what a client-side navigation uses when a route needs a namespace the page did not load.
It takes the locale from `a`, because merging snapshots of different locales is a bug rather than a
feature.

---

## What is *not* here

**No React.** `useMessages` and the provider live in `packages/feature`, because `apps/worker` needs
copy for digest and escalation emails and cannot import React packages. The same `Translator` runs in
the SSR pass, the browser, the worker and the Tauri webview.

**No `MessageStore` yet.** The mutable holder that absorbs namespaces after first render is
[step 20.8](../../../../docs/setup/20-content-package.md) and is not written — nothing calls
`ensure()` until a route loader exists. A `Translator` is what the error path needs; a store around
one is what a navigating app needs.

---

## See also

- [namespace](namespace.md) — where `MessageKey` and `MessageParams` come from
- [ContentSource](content-source.md) — what builds a snapshot
- [error-copy](error-copy.md) — the one caller that must never hit the raw-key branch
