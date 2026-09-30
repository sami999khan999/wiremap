---
title: error-copy
description: ERROR_COPY, FIELD_RULE_COPY and ErrorCopy — the only place in the repository where a failure gets words, and the reason @loadbearing/errors has no message field.
---

# `ERROR_COPY`, `FIELD_RULE_COPY`, `ErrorCopy`

```ts
import type { ErrorCode, ErrorEnvelope, FieldViolation } from "@loadbearing/errors";
import type { Translator } from "../translator.js";
import type { ShellMessageKey } from "./namespace.js";

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

export const FIELD_RULE_COPY: Readonly<Record<string, ShellMessageKey>> = {
  required: "error.field.required",
  tooShort: "error.field.tooShort",
  tooLong: "error.field.tooLong",
  invalidFormat: "error.field.invalidFormat",
  invalid: "error.field.invalid",
};
```

---

## Usage

```ts
const t = await content.translator(locale, []);

ErrorCopy.message(t, envelope);   // the sentence at the top of an error page
ErrorCopy.fields(t, envelope);    // one sentence per field violation, in order
ErrorCopy.field(t, violation);    // a single violation, for an inline field error
```

`envelope` is whatever came off the wire, or `ErrorNormalizer.normalize(thrown).toJSON()` on the
server. Nothing else is needed: `ErrorCopy` reads only `code`, `context` and `fields`.

---

## `ERROR_COPY` is total, by construction

`Record<ErrorCode, ShellMessageKey>` means a new error code **fails to compile** here until it has
copy. That is the point of putting the map in this package rather than a `switch` in a component: the
failure mode it prevents is a raw `SERVER_ONLY` rendered to a customer, which nobody notices in
review and everybody notices in production.

A test asserts the same property at runtime as well. Belt and braces is justified because the
compile-time guarantee weakens the moment someone widens the value type.

**Several codes share one message on purpose.** `BAD_REQUEST`, `UNAVAILABLE` and `INTERNAL` all read
"Something went wrong. Please try again." The distinction between them matters enormously to an
operator reading logs and not at all to the person looking at the screen. Mapping is not duplicating.

---

## The value type is `ShellMessageKey`, and that is load-bearing

`common` and `error` are the two namespaces every `ContentSource` guarantees in every snapshot
([`ContentSource`](content-source.md)). Everything else — `nav`, `auth`, `email` — is lazy, loaded
because a route asked for it.

A `MessageKey` pointing into a lazy namespace renders as **the key itself** when that namespace was
not loaded. That behaviour is deliberate and correct ([`Translator`](translator.md#a-missing-key-renders-as-the-key)),
and it is catastrophic in exactly one place: an error page, which is the screen a user reaches when
something has already gone wrong.

> [!WARNING]
> An earlier revision of this map had `TWO_FACTOR_REQUIRED: "auth.twoFactorRequired"`. `auth` is a
> lazy namespace, so the sign-in error would have rendered as the literal string
> `auth.twoFactorRequired` on any route that had not declared it. Narrowing the value type to
> `ShellMessageKey` makes that unrepresentable instead of remembered — and it is why
> `error.twoFactorRequired` lives in the `error` namespace even though the copy is about
> authentication.

---

## `FIELD_RULE_COPY` cannot be total, and says so

A rule name is whatever a schema produced. `ValidationError` maps Zod issue codes to five rules
today — `required`, `tooShort`, `tooLong`, `invalidFormat`, and the catch-all `invalid` for an issue
code it does not recognise — but Zod's issue codes are an open set that changes between majors, so
this map stays open too.

An unknown rule falls back to `error.unexpected`. The test that matters drives the assertion from
`ValidationError.fromIssues` rather than a hand-written list, so a new issue mapping in `errors`
cannot silently arrive without copy:

```ts
for (const violation of ValidationError.fromIssues(issues).fields ?? []) {
  expect(FIELD_RULE_COPY[violation.rule], violation.rule).toBeTypeOf("string");
}
```

---

## Why `ErrorCopy` is a class and not two call sites

The rendering was once documented as two lines to copy wherever they were needed:

```ts
t(ERROR_COPY[error.code], error.context);
t(FIELD_RULE_COPY[violation.rule] ?? "error.unexpected", violation.params);
```

Both are wrong in ways that only surface on screen, which is the whole argument for writing them
once:

- **The second drops the field name.** `violation.params` is `{ min: 10 }`; the name is
  `violation.field`, a sibling property. Pass params alone and the user reads
  `"{field} must be at least 10 characters."` `ErrorCopy.field` merges the name in.
- **The first does not typecheck if `t()` is narrow.** `ErrorContext` allows `boolean`. That is why
  `Translator.t` takes [`MessageParams`](namespace.md#messageparams) — the same shape as
  `ErrorContext` — rather than `Record<string, string | number>`. Narrowing it makes the most
  important call site in the package fail, and the fix people reach for is a cast.
- **The `?? "error.unexpected"` fallback gets forgotten** at the one call site where the rule turns
  out to be open-ended.

`ErrorCopy` is also where the seam is testable from this side. `errors` asserts that `ServerOnlyError`
names its context key `package`; this package asserts the rendered sentence comes out whole. Neither
package can see the other's half, so both halves are pinned.

---

## `error.serverOnly`, and the exception that stopped existing

```ts
ServerOnly.assert("@loadbearing/infrastructure");
// ServerOnlyError: SERVER_ONLY   context: { package: "@loadbearing/infrastructure" }

ErrorCopy.message(t, error.toJSON());
// "@loadbearing/infrastructure was imported into a client bundle. This is a leak, not a bundle-size
//  problem — it means database or credential code is reachable from the browser."
```

That sentence used to live inside `ServerOnly.assert` as a template literal, and it was the single
error in the repository permitted to carry a message — a developer-facing string, at module load,
that never crossed a wire.

It is copy now. `{package}` interpolates from the error's context, the words are identical, and a
developer reading Bengali could have them in Bengali. **The rule holds with no exceptions**, which is
worth more than the one sentence it cost — see
[core's `ServerOnly`](../../../core/docs/reference/server-only.md#why-the-hardest-case-for-prose-still-loses)
for the argument in full.

It is deliberately untranslated in `bn/error.ts`: a console reader wants the string they can search
for.

---

## Who calls this

`feature`'s `useErrorMessage` and nothing else, which is deliberate: it normalises whatever a query
or mutation threw, renders the code through `ERROR_COPY` and the violations through
`FIELD_RULE_COPY`, and hands back one object. Nine components used to render
`shell.t("state.error")` — "Something went wrong" — against a server that had already said *which*
thing. A `FORBIDDEN` and a `CONFLICT` are different things to be told, and the envelope carried the
difference all the way to the component before it was thrown away.

`apps/web`'s root route uses the same hook for its `errorComponent`, so an uncaught throw anywhere in
the tree gets the catalog's sentence rather than a stack trace.

**Two call sites still branch before falling back**, and both are right to: an invitation that is
`NOT_FOUND` and an invite that is `CONFLICT` have copy of their own in their slice's namespace, which
is more specific than the shared one. They fall through to `ErrorCopy` for everything else, so the
branch adds a sentence rather than replacing the mechanism.

---

## See also

- [namespace](namespace.md) — `ShellMessageKey`, and why it is not `MessageKey`
- [Translator](translator.md) — interpolation, and what a missing key does
- [`@loadbearing/errors`](../../../errors/docs/index.md) — the codes these words are keyed to
- [`ServerOnly`](../../../core/docs/reference/server-only.md) — the one caller that throws at module load
