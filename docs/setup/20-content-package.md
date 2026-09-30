# 20 · `@loadbearing/content`

> Every user-visible string, image reference, and structured record — plus the `ContentSource` seam a CMS will slot into later. React-free.

**Delivers:** `Translator`, `MessageStore`, two `ContentSource` implementations, the four content shapes, and a navigation model a content editor can safely change — with copy split by locale and namespace so no runtime downloads words it cannot use.

**Built in two passes.** The error slice — every word `@loadbearing/errors` needs — came first,
because [09](09-errors-package.md) has no other half and `core`'s `ServerOnly.assert` throws before
anything else in the repository runs. Read the marker legend under the tree below before writing
anything: some of what follows is on disk and some waits on the app that calls it.

**Three items are blocked on later steps, and only three** — `SERVER_CATALOG` plus the `email`
namespace ([25](25-worker-app.md)), `MessageStore` ([24](24-web-app.md)), and
`BundledContentSource` ([30](30-desktop-app.md)). Everything else in
[Step 20.10](#step-2010--what-the-second-pass-adds) is unblocked.

**Prerequisite:** [19 · `@loadbearing/asset`](19-asset-package.md)

---

## Why content is a package

Two reasons, and the second is the one people miss.

**It is React-free on purpose.** `apps/worker` needs copy for digest and escalation emails and cannot import `feature`. The plain `Translator` class works in Node; the React binding (`useMessages`) lives in `feature` ([23](23-feature-package.md)).

**It ships a `ContentSource` abstract class even though `StaticContentSource` is the only implementation today.** That seam is what makes adding a CMS a one-line change in `Container` rather than a rewrite of every component. If you skip the abstraction now because there is only one implementation, the CMS conversation becomes "we would have to touch every screen."

```
packages/content/src/
├── index.ts                                                              ✅
├── import.ts                     ← every external symbol                 ✅
├── primitive/
│   └── locale.ts                 → Locale, Locales                       ✅
├── translator/
│   ├── translator.ts             → Translator, MessageSnapshot           ✅
│   └── message-store.ts          → MessageStore  ← the SSR → client carrier ✅
├── source/
│   ├── content-source.ts         → ContentSource (abstract)              ✅  all four shapes
│   ├── static-content.source.ts  → StaticContentSource   ← split; dynamic import   ✅
│   └── bundled-content.source.ts → BundledContentSource  ← every locale, static    ☐
├── media/                        ── shape 2: media references            ✅
│   ├── index.ts
│   ├── media-ref.ts              → MediaResolver, ResolvedMedia
│   └── static-media.resolver.ts  → StaticMediaResolver
├── message/                      ── shape 1: short keyed strings
│   ├── namespace.ts              → Namespace, NamespaceKeys, MessageKey  ◐  four namespaces
│   ├── catalog.ts                → CLIENT_CATALOG   (locale × namespace → loader)  ◐
│   ├── catalog.server.ts         → SERVER_CATALOG   (+ email)            ☐
│   ├── error-copy.ts             → ERROR_COPY, FIELD_RULE_COPY, ErrorCopy ✅
│   ├── en/                       ← no index.ts; nothing merges these
│   │   ├── common.ts                                                     ✅
│   │   ├── nav.ts                                                        ✅
│   │   ├── auth.ts                                                       ✅
│   │   ├── error.ts                                                      ✅
│   │   └── email.ts              ← the worker's namespace, server-only    ☐  lands with [25](25-worker-app.md)
│   └── bn/                       ← same files; NamespaceBundle<N> each     ●  eight, all total
├── collection/                   ── shape 3: repeating records            ✅
│   ├── index.ts
│   └── nav/
│       ├── index.ts
│       ├── nav.schema.ts         → NavContract, NavItem
│       └── nav.data.ts           → navItems
    ├── index.ts
```

> [!IMPORTANT]
> **This package is deliberately built in two passes, and the first one is already done.**
> ✅ exists and is final · ◐ exists in a reduced form this step describes precisely · ☐ is not
> written yet.
>
> The error slice — `locale.ts`, `translator.ts`, the `common` and `error` namespaces in both
> locales, `error-copy.ts`, and the `ContentSource` seam far enough to hand out a `Translator` —
> was built early, out of order, because [09](09-errors-package.md) has no other half. An
> `ErrorCode` with no copy is a raw `SERVER_ONLY` on a customer's screen, and `ServerOnly.assert`
> in `core` ([07](07-core-package.md#step-74--serveronly)) throws before anything else in the
> repository can. Both needed the words to exist somewhere, and this is the only package allowed
> to hold words.
>
> Nothing in the reduced form is provisional. `namespace.ts` gains `nav`, `auth` and `email` as
> members of a union and a mapped type; the shape does not change, and neither `MessageKey`'s
> closedness nor `ERROR_COPY`'s totality is weaker for having two namespaces instead of five.
> [Step 20.10](#step-2010--what-the-second-pass-adds) is the checklist for finishing it.

**There is no `message/en/index.ts` and no `message/bn/index.ts`.** An earlier draft merged
every namespace into one frozen `en` object and derived `MessageKey` from it, which made that
object load-bearing: `Translator` needed all of English resident, `StaticContentSource` had to
import every locale statically, and the consequence was that a browser downloaded Bengali it
would never read plus the worker's email copy it could never render. **Merging was the bug.**
Step 20.1 keeps the closed key union and drops the merge, which is possible only because types
are erased and runtime data is not.

---

## Step 20.1 — Messages

**`packages/content/src/message/en/common.ts`**

```ts
export const common = {
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.delete": "Delete",
  "action.confirm": "Confirm",
  "state.loading": "Loading…",
  "state.empty": "Nothing here yet",
  "state.error": "Something went wrong",
} as const;
```

**`packages/content/src/message/en/error.ts`**

```ts
export const error = {
  "error.unauthorized": "Please sign in to continue.",
  "error.forbidden": "You do not have permission to do that.",
  "error.notFound": "We could not find what you were looking for.",
  "error.conflict": "Someone else changed this first. Reload and try again.",
  "error.rateLimited": "Too many attempts. Please wait a moment and try again.",
  "error.unexpected": "Something went wrong. Please try again.",
  "error.twoFactorRequired": "Enter the code from your authenticator app to continue.",
  // The developer-facing sentence `ServerOnly.assert` used to carry inline. It is
  // copy like any other now — keyed, interpolated, and translatable — which is why
  // `@loadbearing/errors` has no message field at all.
  "error.serverOnly":
    "{package} was imported into a client bundle. This is a leak, not a bundle-size problem — it means database or credential code is reachable from the browser.",
  "error.field.required": "{field} is required.",
  "error.field.tooShort": "{field} must be at least {min} characters.",
  "error.field.tooLong": "{field} must be at most {max} characters.",
  "error.field.invalidFormat": "{field} is not in the expected format.",
  "error.field.invalid": "{field} is not valid.",
} as const;
```

**`error.serverOnly` is a developer-facing sentence in a user-facing catalog, and it belongs here
anyway.** It is the string [07](07-core-package.md#step-74--serveronly) used to hold inline, and
moving it is what let [09](09-errors-package.md) drop its last exception. It can only ever render
in a build that is already broken — a server-only module executing in a browser — and in that
build you want the words, wherever the error surfaces. `{package}` is interpolated from
`ServerOnlyError`'s context. It is untranslated in `bn/error.ts` on purpose: a console reader wants
the string they can search for.

**There is one `error.field.*` key per rule `ValidationError` can emit** — `required`, `tooShort`,
`tooLong`, `invalidFormat`, and the catch-all `invalid` that an unrecognised Zod issue code becomes
([09](09-errors-package.md#step-94--errornormalizer)). Fewer than that and `FIELD_RULE_COPY` has a
hole a schema can fall through.

**`error.twoFactorRequired` is in this namespace, not in `auth`.** An earlier revision of this
document mapped `TWO_FACTOR_REQUIRED` to `auth.twoFactorRequired`, and that was a defect: `auth` is
a lazily loaded namespace, so the sign-in error would render as the literal string
`auth.twoFactorRequired` on any route that had not declared it. Every value in `ERROR_COPY` has to
be a *shell* key, and the type below is what makes that unrepresentable rather than remembered.

**All error copy lives here, and nothing else does.** `@loadbearing/errors` ([09](09-errors-package.md)) names failures; this package is the only place a sentence about one exists. `Error.message` is the code, so if a user is going to read words, they come from this catalog and they are translated.

That leaves one thing to enforce: a code with no copy. `Record<ErrorCode, ShellMessageKey>` makes it a compile error rather than a raw key rendered to a customer.

**`packages/content/src/message/error-copy.ts`**

```ts
import type { ErrorCode, ErrorEnvelope, FieldViolation } from "@loadbearing/errors";
import type { Translator } from "../translator.js";
import type { ShellMessageKey } from "./namespace.js";

// Total by construction — a new ErrorCode fails to compile until it has copy.
export const ERROR_COPY: Readonly<Record<ErrorCode, ShellMessageKey>> = {
  UNAUTHORIZED: "error.unauthorized",
  FORBIDDEN: "error.forbidden",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  BAD_REQUEST: "error.unexpected",
  TWO_FACTOR_REQUIRED: "error.twoFactorRequired",
  RATE_LIMITED: "error.rateLimited",
  UNAVAILABLE: "error.unexpected",
  INTERNAL: "error.unexpected",
  SERVER_ONLY: "error.serverOnly",
};

// Field-level rules from a ValidationError. Not total: rules are open-ended.
export const FIELD_RULE_COPY: Readonly<Record<string, ShellMessageKey>> = {
  required: "error.field.required",
  tooShort: "error.field.tooShort",
  tooLong: "error.field.tooLong",
  invalidFormat: "error.field.invalidFormat",
  invalid: "error.field.invalid",
};

// The seam an error page, an error boundary, or a toast calls. It exists as a
// class rather than two repeated one-liners so the fallback for an unknown rule
// is written once, and so `context` reaching `t()` as interpolation params is a
// typed fact rather than a convention.
export class ErrorCopy {
  private constructor() {}

  // Shown at the top of an error page. Interpolates the envelope's context.
  public static message(translator: Translator, envelope: ErrorEnvelope): string {
    return translator.t(ERROR_COPY[envelope.code], envelope.context);
  }

  // One sentence per field violation, in envelope order. Empty for a non-validation error.
  public static fields(translator: Translator, envelope: ErrorEnvelope): readonly string[] {
    return (envelope.fields ?? []).map((violation) => ErrorCopy.field(translator, violation));
  }

  // The field name is merged into the params, not left to the caller. Every
  // `error.field.*` template opens with `{field}`, and a violation carries the name
  // separately from its rule params — pass only `params` and the sentence renders
  // with a literal `{field}` in it.
  public static field(translator: Translator, violation: FieldViolation): string {
    return translator.t(FIELD_RULE_COPY[violation.rule] ?? "error.unexpected", {
      field: violation.field,
      ...violation.params,
    });
  }
}
```

**The value type is `ShellMessageKey`, not `MessageKey`, and that is load-bearing.** `common` and
`error` are the two namespaces every `ContentSource` guarantees in every snapshot
([Step 20.7](#step-207--contentsource)); everything else is lazy. A code mapped into a lazy
namespace renders as its own raw key on any route that did not happen to declare it — and an error
page is precisely the screen that cannot afford to be the place a wiring bug shows up. Narrowing
the value type makes it a compile error instead of a screenshot.

**Several codes share one message on purpose.** `BAD_REQUEST`, `UNAVAILABLE` and `INTERNAL` all read "Something went wrong" — the distinction matters to an operator reading logs and not at all to the person looking at the screen. Mapping is not the same as duplicating.

**`FIELD_RULE_COPY` is deliberately not total.** A rule name is whatever a schema produced, so this map cannot be closed the way `ERROR_COPY` is; an unknown rule falls back to `error.unexpected` and a test asserts every rule `ValidationError` can actually emit has an entry.

### Why `ErrorCopy` is a class and not two call sites

An earlier revision of this document gave the rendering as two lines to copy wherever they were
needed:

```ts
t(ERROR_COPY[error.code], error.context);
t(FIELD_RULE_COPY[violation.rule] ?? "error.unexpected", violation.params);
```

Both are wrong in ways that only show up on screen, which is the argument for writing them once:

- **The second line drops the field name.** `violation.params` is `{ min: 10 }` — the name is
  `violation.field`, a sibling property. Pass params alone and the user reads
  `"{field} must be at least 10 characters."` `ErrorCopy.field` merges the name in.
- **The first line does not typecheck.** `ErrorContext` allows `boolean`
  ([09](09-errors-package.md#step-92--the-envelope)) and `t()`'s params did not. Rather than mapping
  the context at every call site, `Translator.t` takes `MessageParams`
  ([Step 20.1](#the-key-union-without-the-merge)), which allows `boolean` for exactly this reason —
  `String(value)` renders it fine.
- **The `?? "error.unexpected"` fallback is the kind of thing that gets forgotten** at the one call
  site where the rule turns out to be open-ended.

`ErrorCopy` is also where the `errors` → `content` seam is testable from this side. `errors` asserts
that `ServerOnlyError` names its context key `package`; this package asserts that the rendered
sentence comes out whole. Neither package can see the other's half, so both halves are pinned.

### The key union, without the merge

**`packages/content/src/message/namespace.ts`**

The version on disk today carries the two shell namespaces. The five-namespace version it grows
into is directly below it, and the difference is four lines.

```ts
import type { common } from "./en/common.js";
import type { error } from "./en/error.js";

// Type-only. `verbatimModuleSyntax` ([04](04-typescript-configs.md)) erases every import
// above, so importing this module pulls in no catalog data at all. That is the whole
// trick: the key union stays complete while the runtime data splits into chunks.
//
// **Partial today.** `nav`, `auth` and the server-only `email` namespaces join this
// interface at their own setup steps. Nothing about the shape below changes when they do.
interface NamespaceShape {
  readonly common: typeof common;
  readonly error: typeof error;
}

// Always present, in every snapshot, from every ContentSource. Never lazy.
export type ShellNamespace = "common" | "error";
// Everything a browser or a desktop bundle may load. Gains `nav` and `auth` later.
export type ClientNamespace = ShellNamespace;
// Gains the server-only `email` namespace when the worker's digests land.
export type Namespace = ClientNamespace;

export type NamespaceKeys = { [K in Namespace]: keyof NamespaceShape[K] & string };

// The complete closed union — same meaning as the old `keyof typeof en`.
export type MessageKey = NamespaceKeys[Namespace];

// Only the keys guaranteed to be in every snapshot. `ERROR_COPY` is typed against
// this rather than `MessageKey`, so an error code cannot be pointed at a lazily
// loaded namespace and render as a raw key on a route that never asked for it.
export type ShellMessageKey = NamespaceKeys[ShellNamespace];

// One locale's copy for one namespace, and total: a key added to `en` with no
// translation is a compile error rather than English inside a Bengali page.
export type NamespaceBundle<N extends Namespace> = Record<NamespaceKeys[N], string>;

// A flat slice across whatever namespaces are loaded.
export type MessageBundle = Partial<Record<MessageKey, string>>;

// What `t()` interpolates. `boolean` is here because `ErrorContext` allows it.
export type MessageParams = Readonly<Record<string, string | number | boolean>>;

export const SHELL_NAMESPACES: readonly ShellNamespace[] = ["common", "error"];
export const CLIENT_NAMESPACES: readonly ClientNamespace[] = ["common", "error"];
```

**What the second pass changes, and nothing else:**

```ts
import type { auth } from "./en/auth.js";     // + 3 type-only imports
import type { email } from "./en/email.js";
import type { nav } from "./en/nav.js";

interface NamespaceShape {
  readonly common: typeof common;
  readonly nav: typeof nav;                    // +
  readonly auth: typeof auth;                  // +
  readonly error: typeof error;
  readonly email: typeof email;                // +
}

export type ClientNamespace = ShellNamespace | "nav" | "auth";
export type ServerNamespace = "email";
export type Namespace = ClientNamespace | ServerNamespace;

export const CLIENT_NAMESPACES: readonly ClientNamespace[] = ["common", "error", "nav", "auth"];
```

`ShellNamespace`, `NamespaceKeys`, `MessageKey`, `ShellMessageKey`, `NamespaceBundle`,
`MessageBundle` and `MessageParams` are untouched, and no consumer of this module changes. That is
the property that made building the error slice early safe rather than a down payment on a
rewrite — `MessageKey` is a closed union over two namespaces exactly as rigorously as over five, so
a typo is a compile error today, and `ERROR_COPY` is total today.

**`MessageKey` is still one closed union.** A typo at a call site is still a compile error, and
`ERROR_COPY: Record<ErrorCode, ShellMessageKey>` above is still total. Nothing about the guarantee
changed — only where the runtime data lives.

> [!NOTE]
> **The shipped repository has more namespaces than this step declares**, and the listings here are
> the state at this build step rather than the finished set. One of the extras is worth knowing
> about while you are choosing where a key goes: `auth` was later split into `auth` (before there is
> a session) and `account` (settings afterwards), because a namespace is a chunk and
> `/forgot-password` was downloading the backup-code warning. The rule that fell out of it — group
> keys by *when they are downloaded*, not by feature area — is in
> [`content/docs/reference/namespace.md`](../../packages/content/docs/reference/namespace.md).

> [!IMPORTANT]
> **`NamespaceKeys` is a mapped type deliberately, and the obvious alternative silently does
> nothing.** The tempting form is a conditional over the namespace:
>
> ```ts
> declare function t<N extends string>(ns: N, key: Extract<MessageKey, `${N}.${string}`>): string;
> t("auth", "error.forbidden");   // compiles — the constraint is decorative
> ```
>
> It fails because the key position is *also* an inference site, so `N` widens to satisfy both
> arguments. `NamespaceKeys[N]` — an indexed access into a mapped type — is not an inference
> site, and rejects the same call. Verified both ways against this repo's compiler flags.
>
> Deriving from the module type rather than a string prefix also handles `common`, whose keys
> are `action.save` and `state.loading`. **Its prefix is not its namespace name**, and any
> template-literal scheme breaks on it.

### A locale is split the same way English is

**`packages/content/src/message/bn/common.ts`**

```ts
import type { NamespaceBundle } from "../namespace.js";

// Partial by design — anything missing falls back to English.
export const common: NamespaceBundle<"common"> = {
  "action.save": "সংরক্ষণ",
  "action.cancel": "বাতিল",
};
```

One file per namespace per locale, mirroring `en/` — two today, five when the second pass lands.
**`NamespaceBundle<"common">` is stricter than the old `Partial<Record<MessageKey, string>>`** — a
key from another namespace in this file is now a compile error, which is what stops `bn/nav.ts` from
quietly shipping auth copy inside the nav chunk. The chunk boundary and the type boundary are the
same boundary.

`bn/error.ts` is the one to read, because it shows the fallback layer doing its job:

```ts
import type { NamespaceBundle } from "../namespace.js";

// Partial by design. `error.serverOnly` is deliberately absent: it is read by a
// developer in a console, so English is the right answer and the fallback layer
// is what supplies it.
export const error: NamespaceBundle<"error"> = {
  "error.unauthorized": "চালিয়ে যেতে সাইন ইন করুন।",
  "error.forbidden": "এটি করার অনুমতি আপনার নেই।",
  "error.notFound": "আপনি যা খুঁজছেন তা আমরা পাইনি।",
  "error.unexpected": "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
  "error.field.required": "{field} আবশ্যক।",
};
```

**Translations still arrive incrementally.** Requiring completeness means either blocking a
locale until it is finished or filling it with placeholder English that nobody notices needs
replacing.

---

## Step 20.2 — The catalog: locale × namespace → loader

**`packages/content/src/message/catalog.ts`**

```ts
import type { Locale } from "../locale.js";
import type { ClientNamespace, MessageBundle, Namespace } from "./namespace.js";

export type BundleLoader = () => Promise<MessageBundle>;

// A catalog need not cover every namespace — a client one deliberately omits `email`.
// The individual catalogs below declare themselves precisely; this is the parameter type.
export type MessageCatalog = Readonly<Record<Locale, Partial<Record<Namespace, BundleLoader>>>>;

// Total over Locale × ClientNamespace — a new locale or client namespace fails to
// compile until every cell exists. The same property `ERROR_COPY` has, for the same
// reason. Note the annotation is the *precise* type, not `MessageCatalog`: widening it
// here would give up the totality check that makes a forgotten cell a build failure.
export const CLIENT_CATALOG: Readonly<
  Record<Locale, Readonly<Record<ClientNamespace, BundleLoader>>>
> = {
  en: {
    common: async () => (await import("./en/common.js")).common,
    error: async () => (await import("./en/error.js")).error,
    // nav, auth: one line each, when those namespaces land.
  },
  bn: {
    common: async () => (await import("./bn/common.js")).common,
    error: async () => (await import("./bn/error.js")).error,
  },
};
```

**Four cells today, and the totality check is already doing work.** `Record<Locale,
Record<ClientNamespace, BundleLoader>>` is what makes adding `"nav"` to `ClientNamespace` a build
failure in two places until both locales have a loader — which is the whole reason the union and
the catalog are separate declarations.

**`packages/content/src/message/catalog.server.ts`** ☐ *not written yet — it has nothing to add
until the `email` namespace exists, and a `SERVER_CATALOG` identical to `CLIENT_CATALOG` would be a
boundary that looks enforced and enforces nothing.*

```ts
import { CLIENT_CATALOG, type MessageCatalog } from "./catalog.js";

// Adds the email namespace. Not importable from client code — [05](05-lint-and-format.md) Step 5.3.
export const SERVER_CATALOG: MessageCatalog = {
  en: { ...CLIENT_CATALOG.en, email: async () => (await import("./en/email.js")).email },
  bn: { ...CLIENT_CATALOG.bn, email: async () => (await import("./bn/email.js")).email },
};
```

> [!NOTE]
> **The ESLint bans on importing `SERVER_CATALOG` are already in place** in
> `tooling/eslint-config/src/index.js` ([05](05-lint-and-format.md) Step 5.3), for `packages/ui`,
> `packages/query` and `apps/web`. A `no-restricted-imports` entry naming an export that does not
> exist yet costs nothing and cannot be forgotten later, which is the right order for a boundary —
> unlike a glob naming a *directory* that does not exist, which is a rule no reader can verify.

**`MessageCatalog` is `Partial` over `Namespace`, and each catalog is not.** That split is the
point: `CLIENT_CATALOG` is declared with an exact `Record<ClientNamespace, …>` so a missing cell
is a compile error, and it is *assignable* to the `Partial` parameter type because a client
catalog genuinely has no `email` entry. Typing the parameter as the total record instead makes
`CLIENT_CATALOG` unassignable to it — the error is `Property 'email' is missing`, and the
tempting fix (giving the client catalog an email cell) is the one that reintroduces the leak.

**Asking a client source for `email` therefore yields nothing rather than throwing** — the
lookup finds no loader, no keys land in the snapshot, and `t()` renders the key
([Step 20.4](#step-204--translator)). That is the documented failure mode, arrived at
structurally: a browser cannot obtain email copy even if something asks for it by name.
`noUncheckedIndexedAccess` ([04](04-typescript-configs.md)) forces the lookup to be
`BundleLoader | undefined` and the filter to be written, so this is checked rather than assumed.

**Every `import()` specifier is a string literal, and that is not a style choice.** A computed
specifier — ``import(`./${locale}/${ns}.js`)`` — is precisely what makes a bundler give up on
static analysis and inline every matching file into the parent chunk. Literal specifiers are
what produce one chunk per locale × namespace. If `dist/` ever holds a single chunk, this is
the line that regressed, and the whole design is inert.

**The loader arrows do not violate the OOP rules.** [05](05-lint-and-format.md) bans
`export const x = () => …` with a selector requiring a direct `VariableDeclarator` parent; an
arrow inside an object literal is not one. It looks like a violation, and someone will try to
"fix" it.

**`.server.ts` is the repo's existing server-only filename suffix**, already an escape-hatch
glob in [05](05-lint-and-format.md) Step 5.2. Reusing it makes the boundary legible from the
filename before anyone opens the file.

**`email` is a namespace, not a separate system.** The worker's digest subject lines come from
the same files the UI uses, through the same `Translator`. Two copy systems means two places
to fix a typo and one of them gets missed. It is *reachable* only through `SERVER_CATALOG`,
and only the worker and the web server ever hold one.

---

## Step 20.3 — `Locale`

**`packages/content/src/primitive/locale.ts`**

```ts
export type Locale = "en" | "bn";

export class Locales {
  private constructor() {}

  public static readonly ALL: readonly Locale[] = ["en", "bn"];
  public static readonly DEFAULT: Locale = "en";

  public static is(value: string | null | undefined): value is Locale {
    return value !== null && value !== undefined && Locales.ALL.includes(value as Locale);
  }

  // `override` wins — a cookie, or a settings screen. Otherwise the first tag that matches.
  public static negotiate(acceptLanguage: string | null, override: string | null): Locale {
    if (Locales.is(override)) return override;

    for (const part of (acceptLanguage ?? "").split(",")) {
      const tag = part.split(";")[0]?.trim().split("-")[0] ?? "";
      if (Locales.is(tag)) return tag;
    }

    return Locales.DEFAULT;
  }
}
```

**`negotiate` takes strings — never a `Request`, never `navigator`.** `apps/web` passes a
header, `apps/desktop` passes `navigator.language`, and this package stays DOM-free and
Node-testable, the same rule that keeps it React-free. `Locales.is()` is also the boundary that
narrows an untrusted locale string to a two-member union before it can index a catalog.

---

## Step 20.4 — `Translator`

**`packages/content/src/translator/translator.ts`**

```ts
import type { Locale } from "../primitive/index.js";
import type { MessageBundle, MessageKey, MessageParams, Namespace } from "../message/index.js";

// The wire format. This exact object is what apps/web inlines into the HTML.
export interface MessageSnapshot {
  readonly locale: Locale;
  // Which namespaces `base` and `overrides` cover. Always includes the shell.
  readonly namespaces: readonly Namespace[];
  // English, for the loaded namespaces only. The fallback layer.
  readonly base: MessageBundle;
  // The requested locale, loaded namespaces only. Empty when locale is "en".
  readonly overrides: MessageBundle;
}

export class Translator {
  public constructor(private readonly snapshot: MessageSnapshot) {}

  public get locale(): Locale {
    return this.snapshot.locale;
  }

  public loaded(namespace: Namespace): boolean {
    return this.snapshot.namespaces.includes(namespace);
  }

  public t(key: MessageKey, params?: MessageParams): string {
    const template = this.snapshot.overrides[key] ?? this.snapshot.base[key];
    if (template === undefined) return key;
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }

  public has(key: MessageKey): boolean {
    return key in this.snapshot.overrides || key in this.snapshot.base;
  }

  public with(overrides: MessageBundle): Translator {
    return new Translator({
      ...this.snapshot,
      overrides: { ...this.snapshot.overrides, ...overrides },
    });
  }

  // Union of two snapshots of the same locale. Used when a navigation adds namespaces.
  public static merge(a: MessageSnapshot, b: MessageSnapshot): MessageSnapshot {
    return {
      locale: a.locale,
      namespaces: [...new Set([...a.namespaces, ...b.namespaces])],
      base: { ...a.base, ...b.base },
      overrides: { ...a.overrides, ...b.overrides },
    };
  }
}
```

**`base` is no longer a total `Record<MessageKey, string>`.** A total record is precisely what
forced all of English to be resident, and with it every locale into every bundle. A
`MessageSnapshot` covers the namespaces actually loaded, and it does three jobs with one
shape: the constructor argument, the JSON that crosses the SSR boundary, and the merge unit
for client-side navigation. One shape, three jobs, no adapters.

**`{name}` interpolation, no library.** ICU MessageFormat handles plurals and gender properly and is the right answer when you need it. Until you do, a twelve-line replace has no dependency, no bundle cost, and no learning curve. Swapping later is a change inside this one class because every call site goes through `t()`.

**`params` is `MessageParams`, which allows `boolean`, and that is not slack.** It is exactly
`ErrorContext` from [09](09-errors-package.md#step-92--the-envelope), so `ErrorCopy.message` can
hand an envelope's context straight to `t()` with no mapping step. Narrowing it to
`string | number` makes the one call site that matters most fail to typecheck, and the fix people
reach for is a cast.

**An unknown placeholder is left as-is**, not replaced with `undefined`. `"Hello {nmae}"` in the UI is obviously a bug; `"Hello undefined"` reads like a data problem and gets investigated in the wrong place.

**A key from an unloaded namespace renders as the key itself**, for the same reason. Seeing
`auth.signIn` on screen is unmistakably a wiring bug — a route that forgot to declare a
namespace ([24](24-web-app.md)) — and it names the exact string to grep for. The alternatives
are worse in both directions: throwing takes down an otherwise healthy page over a forgotten
one-line declaration, and falling back to English ships the bug silently, to be discovered by
a Bengali customer. **Make the failure loud and local, never plausible.**

> [!NOTE]
> **The error path and the loading path cannot reach that branch.** `error.*` and
> `action.*`/`state.*` live in the shell namespaces, which every `ContentSource` puts in every
> snapshot. A raw key can only ever surface in feature copy, which is where a missing
> declaration actually is.

**Immutable `with()`.** Per-recipient locale composition in the worker builds on a shared
instance without mutating it.

---

## Step 20.5 — Media references

> ☐ **Second pass.** Needs [19](19-asset-package.md)'s `ImageManifest`.

**`packages/content/src/media/media-ref.ts`**

```ts
import type { ImageKey } from "@loadbearing/asset";

export interface ResolvedMedia {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

export abstract class MediaResolver {
  public abstract resolve(key: ImageKey): ResolvedMedia;
}
```

**`packages/content/src/media/static-media.resolver.ts`**

```ts
import { ImageManifest, type ImageKey } from "@loadbearing/asset";
import { MediaResolver, type ResolvedMedia } from "./media-ref.js";

export class StaticMediaResolver extends MediaResolver {
  public override resolve(key: ImageKey): ResolvedMedia {
    return ImageManifest.get(key);
  }
}
```

Content records hold `"home.hero"`, never a path. Today that resolves through `ImageManifest`; tomorrow a `CdnMediaResolver` returns a CDN URL for the same key and nothing above changes.

**`ImageKey` is imported as a type only.** `content` may depend on `asset`'s vocabulary without pulling its binaries into the worker's bundle.

---

## Step 20.6 — Navigation, and the line content must not cross

> ☐ **Second pass.** The rule below is already enforced by lint; it is vacuous until `nav.data.ts` exists.

**`packages/content/src/collection/nav/nav.schema.ts`**

```ts
import { z } from "zod";

export class NavContract {
  private constructor() {}

  public static readonly item = z.object({
    // A `ModuleKey`, and never the thing that gates it: `ModuleRegistry` owns that
    // mapping, and a content edit able to change it would be a privilege escalation.
    // `nav.data.ts` pins the narrow type at authoring time; this stays `string`
    // because a CMS row arrives unvalidated.
    module: z.string(),
    labelKey: z.string(),
    icon: z.string(),
    order: z.number().int(),
  });

  public static readonly collection = z.array(NavContract.item);
}

export type NavItem = z.infer<typeof NavContract.item>;
```

**`packages/content/src/collection/nav/nav.data.ts`**

```ts
import { NavContract, type NavItem } from "./nav.schema.js";

export const navItems: readonly NavItem[] = NavContract.collection.parse([
  { module: "rbac", labelKey: "nav.roles", icon: "shield", order: 10 },
  { module: "member", labelKey: "nav.members", icon: "user", order: 20 },
]);
```

### The rule, stated plainly

**Content references the security surface; it never defines it.**

`nav.data.ts` carries `module: "rbac"`, not `permission: "rbac.role.read"`. `ModuleRegistry` in `permissions` ([08](08-permissions-package.md)) maps that key to its gate and its route.

An editor can reorder the menu, rename items, and change icons. An editor **cannot** change what gates a module or point a label at a different route. If `permission` were a content field, a CMS edit would be a privilege escalation — and that is exactly the kind of vulnerability that gets found by accident, years later.

Mechanically: **`content` must never import `PermissionKey`.** Biome's `noRestrictedImports` bans whole modules rather than named exports, and `content` legitimately imports `ModuleKey` from `@loadbearing/permissions` — so this one ban goes in the root ESLint config, which can express it:

```js
// tooling/eslint-config/src/index.js — one block among several
{
  files: ["packages/content/src/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@loadbearing/permissions",
            importNames: ["PermissionKey", "PermissionRegistry"],
            message:
              "Content names a module. ModuleRegistry owns which permission gates it. Import ModuleKey as a type instead.",
          },
        ],
      },
    ],
  },
});
```

**Zod parses the data at module load.** A malformed record is a startup error with a field path, not `undefined.map is not a function` in production — and once content arrives from a database instead of a file, the same schema is the validation boundary with no extra work.

---

## Step 20.7 — `ContentSource`

**`packages/content/src/source/content-source.ts`**

```ts
import type { Locale } from "../primitive/index.js";
import { type Namespace, SHELL_NAMESPACES } from "../message/index.js";
import type { MessageSnapshot, Translator } from "../translator/index.js";

export abstract class ContentSource {
  // In every snapshot, from every implementation. Callers cannot opt out.
  public static readonly SHELL: readonly Namespace[] = SHELL_NAMESPACES;

  // Union of the shell and what was asked for, deduplicated.
  protected static resolve(requested: readonly Namespace[]): readonly Namespace[] {
    return [...new Set([...ContentSource.SHELL, ...requested])];
  }

  public abstract messages(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<MessageSnapshot>;

  public abstract translator(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<Translator>;

  // ☐ The second pass adds two more, once `asset` and the nav collection exist:
  //
  //   public abstract media(key: ImageKey): Promise<ResolvedMedia>;
  //   public abstract nav(): Promise<readonly NavItem[]>;
}
```

**The message half of this seam is complete; the other three shapes are not declared yet.** An
abstract method with no implementation is not a placeholder you can defer — it is a compile error in
`StaticContentSource` the moment it exists. Declaring `media()` now would mean either writing
`StaticMediaResolver` now (which needs `@loadbearing/asset`'s manifest) or stubbing it to throw,
and a seam whose implementations throw is worse than a seam with fewer methods. Adding a method to
an abstract class later is a mechanical change in one implementation; nothing outside the package
depends on the count.

**The shell is added by the base class, not by the caller.** `resolve()` is `protected static`
and every implementation runs its request through it, so "`common` and `error` are always
there" is a property of the seam rather than a convention every call site has to remember. A
`DbContentSource` inherits it for free, and a route that declares `["auth"]` still gets working
error copy.

**`packages/content/src/source/static-content.source.ts`**

```ts
import { ContentSource } from "./content-source.js";
import type { Locale } from "../primitive/index.js";
import { type BundleLoader, CLIENT_CATALOG, type MessageCatalog } from "../message/index.js";
import type { MessageBundle, Namespace } from "../message/index.js";
import { type MessageSnapshot, Translator } from "../translator/index.js";

export class StaticContentSource extends ContentSource {
  // Defaults to the client catalog. The server passes SERVER_CATALOG explicitly.
  public constructor(private readonly catalog: MessageCatalog = CLIENT_CATALOG) {
    super();
  }

  public override async messages(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<MessageSnapshot> {
    const wanted = ContentSource.resolve(namespaces);

    const [base, overrides] = await Promise.all([
      StaticContentSource.load(this.catalog.en, wanted),
      locale === "en"
        ? Promise.resolve({})
        : StaticContentSource.load(this.catalog[locale], wanted),
    ]);

    return { locale, namespaces: wanted, base, overrides };
  }

  private static async load(
    loaders: Partial<Record<Namespace, BundleLoader>>,
    namespaces: readonly Namespace[],
  ): Promise<MessageBundle> {
    // A client catalog has no `email` cell. Skip what this catalog cannot serve
    // rather than throwing — see the note under Step 20.2.
    const present = namespaces
      .map((n) => loaders[n])
      .filter((loader): loader is BundleLoader => loader !== undefined);

    const bundles = await Promise.all(present.map((loader) => loader()));
    return Object.assign({}, ...bundles) as MessageBundle;
  }

  public override async translator(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<Translator> {
    return new Translator(await this.messages(locale, namespaces));
  }

  // ☐ With the second pass, the other three arrive as genuinely synchronous work —
  // so `Promise.resolve` rather than an `async` body, because `require-await`
  // ([05](05-lint-and-format.md)) rejects an async function with no await:
  //
  //   public override media(key: ImageKey): Promise<ResolvedMedia> {
  //     return Promise.resolve(this.media_.resolve(key));
  //   }
  //   public override nav(): Promise<readonly NavItem[]> {
  //     return Promise.resolve(navItems);
  //   }
}
```

**English is always loaded alongside the target locale — per namespace.** That is the fallback
layer, and it is what makes a `Partial<>` locale safe. Loading English *wholesale* was the
original bug; loading it for the four namespaces in play is just the fallback doing its job.

> [!CAUTION]
> **The abstract signatures are async; the static implementation must not be.**
> `@typescript-eslint/require-await` is `"error"` over `packages/*/src/**`
> ([05](05-lint-and-format.md)), so `async media()` with no `await` inside fails lint. Return
> `Promise.resolve(x)` from a plain method instead — identical return type, identical call
> sites, no rule exemption, and it stops the method from claiming asynchrony it does not have.
> `messages()` and `translator()` genuinely await, so they stay `async`.

**`packages/content/src/source/bundled-content.source.ts`** ☐ *not written yet — it lands with
[30](30-desktop-app.md), the app that needs it.*

```ts
// Every locale, every client namespace, statically imported. This is the variant
// apps/desktop takes: there is no SSR to inline from, the locale is not known until
// the process starts, and it has to work with no network at all. It carries no email
// namespace — that is server-only, and a desktop bundle is not a server.
export class BundledContentSource extends ContentSource {
  private readonly media_ = new StaticMediaResolver();

  // Beyond the abstract contract, and the reason this class exists.
  public snapshotSync(
    locale: Locale,
    namespaces: readonly ClientNamespace[] = CLIENT_NAMESPACES,
  ): MessageSnapshot {
    const wanted = ContentSource.resolve(namespaces);

    return {
      locale,
      namespaces: wanted,
      base: BundledContentSource.slice("en", wanted),
      overrides: locale === "en" ? {} : BundledContentSource.slice(locale, wanted),
    };
  }

  public override messages(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<MessageSnapshot> {
    return Promise.resolve(this.snapshotSync(locale, namespaces as readonly ClientNamespace[]));
  }

  // translator / media / nav: all Promise.resolve, as above.
}
```

**`packages/content` still ships every locale, and that is deliberate.** Narrowing is an
*app-level* decision. `apps/web` takes one slice per request because it has a server that knows
the locale before the first byte; `apps/desktop` takes all of it because it has no server, gets
its locale from the OS at runtime, and has to work on a plane ([30](30-desktop-app.md)).
Building the narrowing into the *package* would have made the desktop app impossible — which is
why doc 30 lists `content` as a direct desktop dependency.

**`snapshotSync` sits outside the abstract contract on purpose.** The seam stays async so a CMS
changes no call site; this one implementation additionally offers a synchronous read, which
desktop uses to build its store before first render — no await, no flash, no chunk fetch. Tests
use it for the same reason.

**`Container` constructs the server variant** ([17](17-composition-container.md)):

```ts
this.content = new StaticContentSource(SERVER_CATALOG);
// later:
// this.content = new DbContentSource(this.database, this.cache);
```

One line. **The seam survives the split intact** — that is worth checking rather than assuming,
because a design that made the CMS swap expensive again would have traded the wrong thing.

---

## Step 20.8 — `MessageStore`

> ☐ **Second pass.** Deferred until a route loader calls `ensure()` ([24](24-web-app.md) Step 24.10).

A snapshot is immutable, but client-side navigation adds namespaces after the page has
rendered. `MessageStore` is the mutable holder around it — React-free, so the same class works
in `apps/web`'s SSR pass, in `apps/desktop`, in `apps/worker`, and in Node tests.

**`packages/content/src/translator/message-store.ts`** ☐ *not written yet — nothing calls `ensure()` until a
route loader exists ([24](24-web-app.md) Step 24.10). The error slice needs a `Translator`, not a
store around one.*

```ts
import type { ContentSource } from "../source/index.js";
import type { Namespace } from "../message/index.js";
import { type MessageSnapshot, Translator } from "./translator.js";

export class MessageStore {
  private snapshot: MessageSnapshot;
  private cached: Translator;
  private readonly listeners = new Set<() => void>();
  // Keyed by locale *and* namespace, so a load still running when the locale
  // changes cannot be joined by a caller that now wants the other language.
  private readonly inFlight = new Map<string, Promise<void>>();

  public constructor(
    private readonly content: ContentSource,
    initial: MessageSnapshot,
  ) {
    this.snapshot = initial;
    this.cached = new Translator(initial);
  }

  // Identity is stable until `ensure()` actually adds something. That is not an
  // optimisation — `useSyncExternalStore` ([23](23-feature-package.md)) re-renders
  // forever if its read function returns a new object on every call.
  public get translator(): Translator {
    return this.cached;
  }

  public dehydrate(): MessageSnapshot {
    return this.snapshot;
  }

  public restore(snapshot: MessageSnapshot): void {
    this.snapshot = snapshot;
    this.cached = new Translator(snapshot);
  }

  // Idempotent. Resolves immediately when nothing is missing.
  public async ensure(namespaces: readonly Namespace[]): Promise<void> {
    const { locale } = this.snapshot;
    const missing = namespaces.filter((n) => !this.snapshot.namespaces.includes(n));
    if (missing.length === 0) return;

    // Per namespace, not per requested set: two routes asking for overlapping
    // sets in the same tick share the fetch for what they have in common.
    const fresh = missing.filter((n) => !this.inFlight.has(MessageStore.key(locale, n)));

    if (fresh.length > 0) {
      const load = this.load(locale, fresh);
      for (const n of fresh) this.inFlight.set(MessageStore.key(locale, n), load);
    }

    const waits: Promise<void>[] = [];
    for (const n of missing) {
      const pending = this.inFlight.get(MessageStore.key(locale, n));
      if (pending) waits.push(pending);
    }

    await Promise.all(waits);
  }

  private async load(locale: Locale, namespaces: readonly Namespace[]): Promise<void> {
    try {
      const added = await this.content.messages(locale, namespaces);

      // The locale can change while this is in flight, and what came back is the
      // previous one's copy.
      if (this.snapshot.locale !== locale) return;

      this.restore(Translator.merge(this.snapshot, added));
      for (const listener of this.listeners) listener();
    } finally {
      for (const n of namespaces) this.inFlight.delete(MessageStore.key(locale, n));
    }
  }

  private static key(locale: Locale, namespace: Namespace): string {
    return `${locale}:${namespace}`;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

**Mutable instance fields are fine here.** The static-mutable-state ban in
[05](05-lint-and-format.md) is a selector on `static` members specifically; instance state on a
per-request object is the thing it exists to push you toward.

**A `MessageStore` is per-request on the server**, for exactly the reason `createQueryClient` is
a factory ([21](21-query-package.md)): a module-scope store built during one request serves that
user's locale to the next one.

**`ensure()` is what a route loader calls**, and `dehydrate()`/`restore()` are what carry the
result across the SSR boundary. Both are wired in [24](24-web-app.md) Step 24.10.

**The `inFlight` map is what makes "idempotent" true under concurrency.** Without it, `missing`
is computed from a snapshot that no in-flight load has updated yet, so two route loaders
resolving in the same tick both see the namespace as absent and both fetch it. De-duplication is
per *namespace* rather than per requested set, because two routes rarely declare the same set and
often overlap: `["nav", "auth"]` and `["auth", "role"]` should be two requests covering three
namespaces, not two requests covering four.

**The key carries the locale, and `load()` re-checks it before merging.** A bundle that arrives
after `setLocale()` is the previous language's copy, and merging it puts old sentences under keys
the new bundle also has — the one failure mode here that is silent, because the page renders
fluent text in the wrong language rather than a missing key.

---

## Step 20.9 — The barrel

**`packages/content/src/index.ts`**

What exists today, in full:

```ts
export {
  type BundleLoader,
  CLIENT_CATALOG,
  CLIENT_NAMESPACES,
  type ClientNamespace,
  ERROR_COPY,
  ErrorCopy,
  FIELD_RULE_COPY,
  type MessageBundle,
  type MessageCatalog,
  type MessageKey,
  type MessageParams,
  type Namespace,
  type NamespaceBundle,
  type NamespaceKeys,
  SHELL_NAMESPACES,
  type ShellMessageKey,
  type ShellNamespace,
} from "./message/index.js";
export { type Locale, Locales } from "./primitive/index.js";
export { ContentSource, StaticContentSource } from "./source/index.js";
export { type MessageSnapshot, Translator } from "./translator/index.js";
```

The root barrel names four folder barrels and nothing else, because `src/` holds nothing else.

The second pass adds five lines and changes none of the above:

```ts
export { navItems, NavContract, type NavItem } from "./collection/index.js";
export { MediaResolver, type ResolvedMedia, StaticMediaResolver } from "./media/index.js";
export { SERVER_CATALOG } from "./message/catalog.server.js";        // ☐ with 25
export { BundledContentSource } from "./source/index.js";            // ☐ with 30
export { MessageStore } from "./translator/index.js";                // ✅ with 23
```

Every path goes through a folder barrel, because `src/` holds only `index.ts` and `import.ts`
([Folders](../opinions/folders.md)).

**The scaffold's `ContentPackage` placeholder is gone.** [06](06-package-anatomy.md) emits one per
package so the barrel has a real export before the package has real code; this package has real code
now, and a placeholder left in a barrel is something `apps/web` eventually imports by accident.

**No catalog is on the list, in either locale.** `en` used to be exported — it was the merged
frozen object, and exporting it meant any consumer could re-create the whole problem with one
import. The only route to copy is now a `ContentSource`, which is the only thing that knows how
to load a namespace and the only place the shell is guaranteed. `navItems` and `bn` are not on
the list for the same reason they never were: they are data the source reads.

**`SERVER_CATALOG` *is* on the list, and `email` copy is reachable through it.** The barrel
cannot express "server-only" — [29](29-naming-and-boundaries.md) §1.3 forbids a second
JavaScript entrypoint, so there is nowhere else to put it. The boundary is a **named-export
ban in ESLint** instead ([05](05-lint-and-format.md) Step 5.3), which is the same mechanism, in
the same tool, as this package's own `PermissionKey` ban.

### `"sideEffects": false` is load-bearing here

Add it to `packages/content/package.json` ([06](06-package-anatomy.md)):

```json
"sideEffects": false,
```

`BundledContentSource` statically imports every locale, and `packages/feature` imports
`Translator` from this same barrel. **Without that flag no bundler can prove the unused class
is droppable**, and the Bengali catalog rides into the client chunk through a barrel that never
asked for it. This is the one package where the flag decides whether the design works rather
than shaving a kilobyte — and [26](26-hygiene-and-ci.md)'s bundle grep is what proves it did.

---

## Step 20.10 — What the second pass adds

The error slice is done and gated below. Finishing the package is these eight items, in any order,
each of which is additive:

| # | Add | Needs | Touches |
| --- | --- | --- | --- |
| 1 | `message/en/nav.ts` + `bn/nav.ts` | — | `NamespaceShape`, `ClientNamespace`, `CLIENT_NAMESPACES`, two `CLIENT_CATALOG` cells |
| 2 | `message/en/auth.ts` + `bn/auth.ts` | [16](16-auth-package.md) for the copy it needs | same four places |
| 3 | `message/en/email.ts` + `bn/email.ts`, `catalog.server.ts` | **[25](25-worker-app.md)** — the worker is what defines the copy | `ServerNamespace`, `Namespace`, the barrel |
| 4 | `media/` — `MediaResolver`, `StaticMediaResolver` | [19](19-asset-package.md)'s `ImageManifest` | `ContentSource.media()`, the barrel |
| 5 | `collection/nav/` — `NavContract`, `navItems` | `zod` (already a dependency), `ModuleKey` from `permissions` | `ContentSource.nav()`, the barrel |
| 7 | `translator/message-store.ts` — `MessageStore` | [23](23-feature-package.md)'s `MessageProvider` is the caller | the barrel |
| 8 | `bundled-content.source.ts` — `BundledContentSource` | **[30](30-desktop-app.md)** | the barrel |

**Items 1, 2, 4, 5 and 6 are unblocked and go in together.** Doing them as one pass is what makes
`ContentSource` declare all four shapes at once — which matters, because an abstract method with no
implementation is a compile error in `StaticContentSource` the moment it exists, so the seam and its
one implementation have to move in the same commit.

**Items 3 and 8 wait on a caller, not on anything here.** (Item 7's caller turned out to be
[23](23-feature-package.md)'s `MessageProvider`, not [24](24-web-app.md)'s loader — it subscribes to
the store; the loader only calls `ensure()` on it later.) Each is listed in the barrel snippet
above with the step it arrives with. Until item 3 lands, [17](17-composition-container.md)'s
`Container` constructs `new StaticContentSource()` with no argument.

> [!NOTE]
> **Items 5 and 6 need a decision this document does not make.** `nav.data.ts` wants two types for
> one record: the Zod schema stays wide (`module: z.string()`) because it is what will parse a
> database row, and the authored literal is pinned against a narrower `NavRecord`
> (`module: ModuleKey`, `labelKey: NamespaceKeys["nav"]`, `icon: IconName`) with
> `as const satisfies`. Both checks run and they check different things — narrowing the schema to
> the unions instead makes it unable to parse the untrusted input it exists for.
>
> A fourth shape, long-form editorial, was declared here for a while: `document(slug)` on the
> source plus a contract and an entity to parse a row no adapter returned. It was deleted rather
> than finished — see
> [`content-shapes`](../../packages/content/docs/reference/content-shapes.md). Building it
> *with* a `DbContentSource` costs the same as building it before one, and the interim
> `string | null` was already narrower than the entity beside it.

**Two things are worth re-checking rather than assuming when item 3 lands.** `SERVER_CATALOG` is the
first thing that makes `Namespace` wider than `ClientNamespace`, so it is the first time
`MessageCatalog` being `Partial` over `Namespace` does any work — the note under
[Step 20.2](#step-202--the-catalog-locale--namespace--loader) explains why typing it as the total
record instead is the mistake that reintroduces the leak. And `StaticContentSource.load` skipping a
namespace its catalog cannot serve is currently tested with a hand-built empty catalog; once a real
client/server split exists, test it with `CLIENT_CATALOG` and `"email"`, which is the case that
actually matters.

**Item 5 is where [Step 20.6](#step-206--navigation-and-the-line-content-must-not-cross)'s rule
starts being enforceable.** The ESLint ban is already configured and already passing — vacuously,
because nothing in this package imports `@loadbearing/permissions` at all. It stops being vacuous the
moment `nav.data.ts` names a module, which is also when `permissions` joins this package's
dependencies for `ModuleKey` and nothing else.

---

## ✅ Gate

The error slice, which is what exists:

- `new Translator(snapshot).t("error.field.required", { field: "Email" })` returns `"Email is required."`
- A misspelled `MessageKey` is a compile error, and so is a `bn/error.ts` entry keyed
  `"action.save"` — `NamespaceBundle<"error">` will not take it.
- `await new StaticContentSource().messages("bn", [])` returns a snapshot whose `namespaces` is
  exactly `["common", "error"]`, whose `overrides` hold the Bengali copy, and whose `base` holds
  English for the same keys. The shell arrives without being asked for.
- **Every `ErrorCode` renders.** For each key of `ERROR_CATALOG`, `t.has(ERROR_COPY[code])` is
  `true` against a translator built with `messages("en", [])` — a snapshot that asked for nothing.
  This is the assertion that catches a code pointed at a lazily loaded namespace, which the
  compiler cannot catch once `ShellMessageKey` widens.
- **The `errors` seam round-trips.**
  `ErrorCopy.message(t, new ServerOnlyError("@loadbearing/infrastructure").toJSON())` returns the
  full sentence with `@loadbearing/infrastructure` substituted for `{package}`. That single assertion covers the whole
  redesign in [09](09-errors-package.md) Step 9.3: the code carries no prose, and the prose is here.
- `grep -rn "PermissionKey" packages/content/src` returns nothing. **Including comments** — the
  obvious comment on `nav.schema.ts` explaining why the field is a module key fails this gate by
  naming the thing it is telling you not to use. Paraphrase. Docs [18](18-api-client-package.md) and
  [21](21-query-package.md) have gates with the same shape and the same trap.
- `pnpm --filter @loadbearing/content build` succeeds with no React in the output, **and emits
  more than one chunk in `dist/`** — one per locale × namespace. Five files today
  (`index.js` plus `common-*.js` and `error-*.js` for each locale). A single chunk means the
  dynamic imports got inlined and the entire split is inert.
- `grep -c "সংরক্ষণ" packages/content/dist/index.js` is `0`. Bengali reaches the entry chunk only
  if the split broke.
- `pnpm lint` passes with `require-await` on, which it will not if any `ContentSource` method
  is `async` with no `await` in its body.

```bash
pnpm --filter @loadbearing/content test        # 28 tests
```

> [!NOTE]
> `packages/content/vitest.config.ts` needs `resolve: { conditions: ["development"] }`, for the same
> reason `core`'s does ([07](07-core-package.md#step-76--a-first-test)): the specs import
> `@loadbearing/errors`, and without it they run against that package's `dist/`.

Do not proceed until this passes. The eight items in Step 20.10 are not gated here — each is gated
by the step that needs it.

---

[← `@loadbearing/asset`](19-asset-package.md) · [`@loadbearing/query` →](21-query-package.md)
