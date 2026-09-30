---
title: errors
description: One failure shape every runtime throws, serialises and reconstructs — carrying structured context and no prose, because content owns every word a user reads.
---

# `@loadbearing/errors`

A failure has to be understood in four places: the use-case that throws it, the transport that maps it
to a status, the component that decides what to render, and the worker that logs it and retries or does
not. This package is the vocabulary all four share.

```
packages/errors/
├── src/
│   ├── index.ts              ← no import.ts: this package takes nothing from outside
│   ├── catalog/              ← one fragment per slice, team-owned
│   │   ├── index.ts          ←   ERROR_CATALOG, ErrorCode, ErrorMeta, ErrorSeverity
│   │   └── core.errors.ts
│   ├── error/                ← the base class and one subclass per code with context
│   │   ├── app.error.ts      → AppError, ErrorEnvelope, FieldViolation, TransportError
│   │   ├── forbidden.error.ts · not-found.error.ts · conflict.error.ts
│   │   ├── unauthorized.error.ts · two-factor-required.error.ts
│   │   ├── validation.error.ts · internal.error.ts
│   │   ├── rate-limited.error.ts · unavailable.error.ts  ★ thrown by adapters only
│   │   └── server-only.error.ts   ★ thrown by core, at module load
│   ├── normalizer/
│   │   └── error-normalizer.ts → ErrorNormalizer
│   └── transport/
│       └── http.ts           → HTTP_STATUS   ★ adapters only, never the domain
└── tests/
    ├── error/{app,server-only,validation}.error.spec.ts
    └── normalizer/error-normalizer.spec.ts
```

Zero dependencies — the root of the workspace graph. Any dependency would exclude one of those four
runtimes, and then the vocabulary stops being shared. `@loadbearing/core` depends on *this* package,
not the other way round, because [`ServerOnly.assert`](../../core/docs/reference/server-only.md)
throws and there is no such thing here as a bare `Error`.

---

## The rule everything else follows from

**An error carries no message.** `Error.message` is the code:

```ts
new ForbiddenError("task.reactivate").message; // "FORBIDDEN"
```

Every word a user reads lives in [`@loadbearing/content`](../../content/docs/index.md), keyed by code
and translated. This is the same division `permissions` draws — `permissions` owns `PermissionKey`,
`content` owns the label, and `content` is lint-banned from naming a permission at all.

It is also the strongest available form of "no built-in error messages", because there is no message
to leak, to forget to translate, or to match on. Three things follow, and each is an improvement:

- **Logs get fields, not sentences.** `{ code, permission, goalId }` is what you filter on at 3am.
- **The server never sends prose.** It sends `{ code, context }`; the client renders in *its* locale.
  A desktop app running in a different language than the server is correct for free.
- **A reporter groups by code**, rather than fragmenting one bug into a thousand interpolated strings.

> [!WARNING]
> The temptation is to add "just a short developer message" to the base class. Don't. The moment such a
> field exists, something renders it — a toast, a log line pasted into a ticket, a `<pre>` in an error
> boundary — and user-facing text now lives outside `content` and outside translation. Structured
> `context` covers every legitimate use.

### There is no exception, including the one that used to exist

`ServerOnly.assert` in `core` is the hardest case in the repository: it fires at module load, for a
developer reading a console, and never crosses a wire. It throws `ServerOnlyError` — code
`SERVER_ONLY`, context `{ package }` — and the long sentence it used to carry inline now lives in
`content` as `error.serverOnly`, with `{package}` interpolated from that context.

```ts
new ServerOnlyError("@loadbearing/infrastructure").message;   // "SERVER_ONLY"
ErrorCopy.message(translator, error.toJSON());    // "@loadbearing/infrastructure was imported into a client …"
```

Nothing was lost — the words are identical, and now translatable. What the throw site keeps is a
greppable code and a field a log query can filter on. The full argument, including the case *for*
the exception and why it fails, is on
[core's `ServerOnly` page](../../core/docs/reference/server-only.md#why-the-hardest-case-for-prose-still-loses).

---

## The four exports

### [`AppError`](reference/app-error.md) — the shape

```ts
throw new ForbiddenError("task.reactivate", goalId);

error.code;        // "FORBIDDEN"  — a closed union, switchable
error.context;     // { permission, goalId }  — interpolated into copy
error.retryable;   // read from the catalog, not restated
error.toJSON();    // the wire envelope
AppError.from(envelope);  // reconstructed on the client, or null if the code is unknown
```

`toJSON()` / `from()` is deliberately the same idiom as `CapabilitySet` — the server throws, the wire
carries JSON, the client rebuilds a class it can branch on. `from()` returns `null` for an unrecognised
code rather than trusting it, because an envelope is untrusted input.

### [`ErrorNormalizer`](reference/error-normalizer.md) — the handler

```ts
ErrorNormalizer.normalize(anythingAtAll); // → AppError, always
```

| Thrown | Becomes |
| --- | --- |
| an `AppError` | itself |
| a Zod-shaped error | `ValidationError` with `{ field, rule, params }` |
| an `Error`, a string, `undefined`, `null`, a number | `INTERNAL`, original kept off the envelope |

### [`ERROR_CATALOG`](reference/catalog.md) — the vocabulary

Team-owned fragments merged in a platform-owned barrel, exactly like the permission catalog, with
`ErrorCode = keyof typeof ERROR_CATALOG` as a closed union. Metadata is transport-agnostic: `retryable`
is a fact about the code that `query` and the worker both read, so they cannot disagree by convention;
`severity` separates "someone tried something they cannot do" from "we are broken".

### `HTTP_STATUS` — quarantined on purpose

Total over `ErrorCode`, so a new code fails to compile until it has a status. `application` may not
import it: `ForbiddenError` is a domain concept and `403` is a transport one, and that separation is
most of what keeps the transport swappable. ESLint enforces the import name.

---

## Testing

32 tests. The ones worth knowing about:

- **`normalize()` is total** — an `Error`, a string, `undefined`, `null`, a number and a plain object
  all yield a valid envelope.
- **No original text escapes.** A Postgres-flavoured `Error("… relation \"user_api_keys\" …")` is
  normalised and the table name is asserted absent from `JSON.stringify(envelope)`. That is the
  requirement, so it is tested directly rather than inferred.
- **Zod's default message is discarded** — asserted against a realistic issue that carries one.
- **Structural detection works across package copies**, and an unknown code is *not* mistaken for ours.
- **The catalog and `HTTP_STATUS` have not drifted.**
- **`ServerOnlyError` names its context key `package`** — asserted as a key list, because that key is
  the placeholder in `error.serverOnly` and renaming it breaks only the rendered sentence.
  `content` pins the other end of the same seam.

```bash
pnpm --filter @loadbearing/errors test
```

---

## See also

- [AppError](reference/app-error.md) · [ErrorNormalizer](reference/error-normalizer.md) · [catalog](reference/catalog.md)
- [Build order · 09 · errors](../../../docs/setup/09-errors-package.md)
- [`@loadbearing/content`](../../content/docs/reference/error-copy.md) — the other half: `ERROR_COPY`, `ErrorCopy`
- [`@loadbearing/core`](../../core/docs/reference/server-only.md) — the one caller that throws at module load
- [`@loadbearing/permissions`](../../permissions/docs/index.md) — the same codes-here/copy-there split
