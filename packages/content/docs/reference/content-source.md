---
title: ContentSource
description: The abstract seam a CMS slots into, StaticContentSource behind it, and why the shell namespaces are a property of the base class rather than a convention.
---

# `ContentSource`, `StaticContentSource`

```ts
export abstract class ContentSource {
  public static readonly SHELL: readonly Namespace[] = SHELL_NAMESPACES;

  protected static resolve(requested: readonly Namespace[]): readonly Namespace[] {
    return [...new Set([...ContentSource.SHELL, ...requested])];
  }

  public abstract messages(locale: Locale, namespaces: readonly Namespace[]): Promise<MessageSnapshot>;
  public abstract translator(locale: Locale, namespaces: readonly Namespace[]): Promise<Translator>;
}
```

> [!NOTE]
> **Two methods at first, four now.** `media()` and `nav()` joined
> the contract once `@loadbearing/asset`'s manifest and the nav collection exist. See
> [Why the contract is short](#why-the-contract-is-short-rather-than-stubbed).

---

## Why an abstraction with one implementation

`StaticContentSource` is the only implementation today, and the seam still earns its place: adding a
CMS later is one line in `Container` rather than a rewrite of every screen.

```ts
this.content = new StaticContentSource(SERVER_CATALOG);
// later:
// this.content = new DbContentSource(this.database, this.cache);
```

Skip the abstraction now because there is only one implementation, and the CMS conversation becomes
"we would have to touch every component."

**Every method is async even though the static implementation is mostly synchronous.** That is the
same decision: a `DbContentSource` cannot be synchronous, so a synchronous seam would make the swap a
breaking change at every call site.

> [!CAUTION]
> `@typescript-eslint/require-await` is an error across `packages/*/src/**`, so a method that
> satisfies an async signature with no `await` in its body must be written
> `return Promise.resolve(x)` rather than `async`. Identical return type, identical call sites, no
> rule exemption — and it stops the method claiming asynchrony it does not have. `messages()` and
> `translator()` genuinely await, so they stay `async`.

---

## The shell is a property of the seam

`resolve()` is `protected static`, and every implementation runs its request through it:

```ts
await new StaticContentSource().messages("en", []);
// namespaces: ["common", "error"]
```

So "`common` and `error` are always there" is enforced by the base class rather than remembered by
every caller. A route that declares `["auth"]` still gets working error copy and loading states, and a
future `DbContentSource` inherits the guarantee for free.

That guarantee is what makes
[`ERROR_COPY`](error-copy.md#the-value-type-is-shellmessagekey-and-that-is-load-bearing) safe: every
value in it is a shell key, so an error page can render whatever it is handed, on any route, with no
namespace declaration of its own.

---

## `StaticContentSource`

```ts
public constructor(private readonly catalog: MessageCatalog = CLIENT_CATALOG) {
  super();
}
```

The default is the client catalog; the server passes `SERVER_CATALOG` explicitly, which is how the
email namespace stays server-only without a second entrypoint.

### English is always loaded alongside the target locale — per namespace

```ts
const [base, overrides] = await Promise.all([
  StaticContentSource.load(this.catalog.en, wanted),
  locale === "en" ? Promise.resolve({}) : StaticContentSource.load(this.catalog[locale], wanted),
]);
```

That is the fallback layer, and it is what makes a `Partial` locale safe. Loading English *wholesale*
was the original bug; loading it for the namespaces in play is the fallback doing its job.

### A namespace the catalog cannot serve is skipped, not thrown

```ts
const present = namespaces
  .map((namespace) => loaders[namespace])
  .filter((loader): loader is BundleLoader => loader !== undefined);
```

A client catalog has no `email` cell, so asking for it yields nothing: no loader, no keys in the
snapshot, and `t()` renders the key. **A browser structurally cannot obtain server-only copy even if
something asks for it by name** — that is a property of the data, not a check somebody wrote.

`noUncheckedIndexedAccess` forces the lookup to be `BundleLoader | undefined` and the filter to be
written, so this is checked rather than assumed.

---

## Why the contract is short rather than stubbed

`media()` and `nav()` were not declared at first, and the alternative was worse in both
available forms.

An abstract method is not a placeholder you can defer — it is a compile error in every subclass until
it is implemented. So declaring `media()` today would mean either writing `StaticMediaResolver` today
(which needs `@loadbearing/asset`'s `ImageManifest`, a later step) or stubbing it to throw. **A seam
whose implementations throw is worse than a seam with fewer methods**: it looks complete, it typechecks
at every call site, and it fails at runtime in whatever screen happened to call it first.

Adding a method to an abstract class later is a mechanical change in one implementation. Nothing
outside this package depends on the count.

---

## What is not written yet

| | |
| --- | --- |
| `media()`, `nav()` | with `@loadbearing/asset` and the nav collection |
| `SERVER_CATALOG` | with the `email` namespace — a copy of `CLIENT_CATALOG` would be a boundary that enforces nothing |
| `BundledContentSource` | with the desktop app: every locale statically imported, `snapshotSync` for a first render with no await and no chunk fetch |
| `MessageStore` | when a route loader calls `ensure()` |

---

## See also

- [Translator](translator.md) — what `translator()` hands back
- [namespace](namespace.md) — `SHELL_NAMESPACES` and the union it comes from
- [error-copy](error-copy.md) — the caller that depends on the shell guarantee
- [Build order · 20 · content](../../../../docs/setup/20-content-package.md)
