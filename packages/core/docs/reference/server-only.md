---
title: server-only
description: ServerOnly.assert — the runtime tripwire that catches database or credential code reaching a client bundle, the ServerOnlyError it throws, and the two other defences it sits between.
---

# `ServerOnly`

```ts
import { ServerOnlyError } from "@loadbearing/errors";

export class ServerOnly {
  private constructor() {}

  // Call at the top of every server-only package barrel.
  public static assert(packageName: string): void {
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
      throw new ServerOnlyError(packageName);
    }
  }
}
```

This is the one import in `@loadbearing/core`, and the reason the package declares
[`@loadbearing/errors`](../../../errors/docs/index.md) as its single dependency.

---

## Who calls it

Four barrels, on their first line, before any other import has a chance to run side effects:

```ts
// packages/infrastructure/src/index.ts
import { ServerOnly } from "@loadbearing/core";
ServerOnly.assert("@loadbearing/infrastructure");
```

| Package | Why |
| --- | --- |
| `infrastructure` | connection pool, full table shapes |
| `infrastructure` | queue and cache clients, vendor SDKs |
| `auth` | signing secrets, session handling |
| `composition` | wires all three together |

---

## Three defences, one mistake

`ServerOnly` is the middle one. Each catches the leak at a different moment, and each can be
bypassed on its own.

| # | Defence | Catches it | Bypassed by |
| --- | --- | --- | --- |
| 1 | [`noRestrictedImports`](../../../../tooling/biome-config/docs/reference/boundary.md) in Biome, plus the ESLint boundary | authoring time | an `overrides` escape hatch, or a path nobody listed |
| 2 | **`ServerOnly.assert`** | runtime, on first import | never being reached because the import is tree-shaken |
| 3 | The CI bundle grep in [26](../../../../docs/setup/26-hygiene-and-ci.md) | build time | not building the app it greps |

> [!CAUTION]
> Three feels like a lot for one mistake. It is calibrated to the cost, not the likelihood: a
> Drizzle import reaching the client ships the shape of your connection string and your full table
> schema to anyone who opens devtools. It is not a bundle-size regression.

---

## Why the check goes through `globalThis`

The obvious spelling does not compile in this package:

```ts
if (typeof window !== "undefined") {   // TS2304: Cannot find name 'window'
```

> [!WARNING]
> **A `typeof` guard does not exempt an undeclared identifier.** TypeScript tolerates
> `typeof x` only when `x` is *declared* and might be `undefined` at runtime; on a name it has
> never heard of, it still errors. Verified — this is the first thing that fails when you build
> `core` from the doc's original listing.

[`library.json`](../../../../tooling/tsconfig/docs/reference/presets.md) sets `lib: ["ES2024"]` with no DOM, so
`window` is genuinely unknown here — and that is the point, not an oversight. Widening `globalThis`
to `{ window?: unknown }` performs the identical runtime test with a type the compiler can resolve:

```ts
if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
```

Adding `"DOM"` to `lib` would fix the error and destroy the property being relied on. An ambient
`declare const window` would collide with `@types/node` wherever both reach one program. See
[uuid](uuid.md#why-crypto-is-not-a-global-here) for the same shape of problem with `crypto`.

---

## What it does not catch

- **A type-only import.** `import type { Db } from "@loadbearing/infrastructure"` emits nothing, so the barrel
  never runs. That is correct — nothing leaked.
- **A tree-shaken import.** If a bundler drops the barrel's side effect, the assert never fires.
  Defence 3 exists for this.
- **Server code running in a non-browser sandbox that happens to define `window`.** A false
  positive is possible in principle; none has occurred in practice, and the failure mode is a loud
  crash at startup rather than a silent leak.

---

## What it throws, and where the words went

```ts
ServerOnly.assert("@loadbearing/infrastructure");
// ServerOnlyError: SERVER_ONLY
//   context: { package: "@loadbearing/infrastructure" }
```

`Error.message` is `"SERVER_ONLY"`. There is no sentence on the error, because
[`@loadbearing/errors`](../../../errors/docs/index.md) has no message field to put one in and this
throw does not get an exception to that rule.

The sentence still exists, in the only package allowed to hold sentences:

```ts
// packages/content/src/message/en/error.ts
"error.serverOnly":
  "{package} was imported into a client bundle. This is a leak, not a bundle-size problem — " +
  "it means database or credential code is reachable from the browser.",
```

```ts
ErrorCopy.message(translator, error.toJSON());
// "@loadbearing/infrastructure was imported into a client bundle. This is a leak, not a …"
```

`{package}` comes from the error's context — which is why the context key is `package` and not
`packageName`. Rename it and the rendered sentence quietly contains a literal `{package}`; nothing
else breaks, so both sides pin it with a test.

### Why the hardest case for prose still loses

This throw has the best available argument for carrying a message, and it is worth understanding why
the argument fails rather than treating the rule as arbitrary:

| The case for prose | Why it does not hold |
| --- | --- |
| The reader is a developer at module load — no request, no locale, no `Translator`. | True, and beside the point. The reader still wants words; `content` is where words are. The throw site wants the code and the package name, which is what it has. |
| The prose is the payload — "this is a leak, not a bundle-size problem" is what stops someone reaching for a bundler setting. | It still says exactly that, from `error.serverOnly`, and now a developer reading Bengali can get it in Bengali. |
| It never crosses a wire, so the reasons for keeping text out of errors do not apply here. | One does. A `message` field on `AppError` is a field that gets *rendered* — by a toast, by a `<pre>` in an error boundary, by a log line pasted into a ticket. It is enforceable only with no exceptions, and here the exception costs nothing. |

What the stack trace gives up is nothing:

```
ServerOnlyError: SERVER_ONLY
    at ServerOnly.assert (…)
    at packages/infrastructure/src/index.ts:2:12
```

The class names the fault; the frame below it names the package that leaked. And
`{ package: "@loadbearing/infrastructure" }` is a field a log query can filter on, which a sentence is not.

> [!NOTE]
> An earlier revision of this page argued the opposite and told you not to invert `core` and
> `errors` to "fix" it. Inverting them was the fix — `errors` is a zero-dependency leaf, the edge is
> acyclic, and `pnpm build:packages` builds `errors` first. See
> [09 · Step 9.3](../../../../docs/setup/09-errors-package.md).

---

## See also

- [`@loadbearing/core`](../index.md)
- [Clock](clock.md) · [Result](result.md) · [Uuid](uuid.md)
- [The server-only boundary](../../../../tooling/biome-config/docs/reference/boundary.md) — defence 1
- [`@loadbearing/errors`](../../../errors/docs/index.md) — `ServerOnlyError`, and the rule with no exceptions
- [`@loadbearing/content`](../../../content/docs/reference/error-copy.md) — where `error.serverOnly` lives
