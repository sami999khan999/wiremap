---
title: catalog
description: ERROR_CATALOG and HTTP_STATUS — a closed code union, why the metadata is transport-agnostic, and why the status map is quarantined from the domain layer.
---

# `ERROR_CATALOG`

```ts
export type ErrorSeverity = "expected" | "unexpected";

export interface ErrorMeta {
  readonly retryable: boolean;
  readonly severity: ErrorSeverity;
}

export const ERROR_CATALOG: { readonly [code: string]: ErrorMeta };
export type ErrorCode = keyof typeof ERROR_CATALOG;
```

Team-owned fragments merged in a platform-owned barrel, `as const satisfies Record<string, ErrorMeta>`,
and `ErrorCode` derived with `keyof typeof` — the same construction as `CATALOG` in
[`@loadbearing/permissions`](../../../permissions/docs/reference/permission-registry.md), for the same
payoff: the union is closed, so a misspelled code is a compile error rather than a runtime `undefined`.

The ten shipped codes:

| Code | `retryable` | `severity` | Thrown by |
| --- | --- | --- | --- |
| `UNAUTHORIZED` | no | expected | `UnauthorizedError` |
| `FORBIDDEN` | no | expected | `ForbiddenError` |
| `NOT_FOUND` | no | expected | `NotFoundError` |
| `CONFLICT` | no | expected | `ConflictError` |
| `BAD_REQUEST` | no | expected | `ValidationError` |
| `TWO_FACTOR_REQUIRED` | no | expected | `TwoFactorRequiredError` |
| `RATE_LIMITED` | **yes** | expected | an adapter |
| `UNAVAILABLE` | **yes** | unexpected | an adapter |
| `INTERNAL` | no | unexpected | `InternalError`, via `ErrorNormalizer` |
| `SERVER_ONLY` | no | unexpected | `ServerOnlyError`, from `core` at module load |

**Every code has a class, and two of them are thrown only by adapters.** `RateLimitedError` takes
the limiter's name; `UnavailableError` takes a dependency and an optional status — `("openai.embeddings",
503)`, `("smtp")`. Neither is raised by domain code, because a rate limiter and a health check are
adapters, but both needed a class the moment an adapter had context worth carrying: the dependency
that failed is the whole diagnostic, and putting it in a message rather than in `ErrorContext` is
what would let a vendor's response body reach the wire.

A class exists for a code when something needs to *throw* it with context. That turned out to be
every code.

**`SERVER_ONLY` gets `500` in `HTTP_STATUS` and can never be served.** The record is total over
`ErrorCode`, so it needs a number; no request can reach it, because the module that would serve the
request is the one that failed to load.

---

## The metadata is transport-agnostic on purpose

**`retryable` is a fact about the code, not a policy.** Before this package existed, the retry rule was
written inline in the query client:

```ts
const code = (error as { code?: string }).code;
if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || code === "BAD_REQUEST") return false;
```

An untyped cast, three codes hardcoded, and a second copy of the same judgement waiting to be written
for BullMQ in the worker. Declaring it once means the two cannot drift:

```ts
if (!ERROR_CATALOG[normalized.code].retryable) return false;
```

**`severity` is what separates a log line from an alert.** `FORBIDDEN` is `expected` — someone tried
something they cannot do, which is the system working. `UNAVAILABLE` is `unexpected` — we are broken.
Both are errors; only one should wake anybody, and encoding that next to the code means the decision
does not get re-litigated in each consumer.

---

## `TWO_FACTOR_REQUIRED` is not really a failure

It is a fork in the sign-in flow, and it exists as a code for one reason: so nothing has to do this,
which is what [23](../../../../docs/setup/23-feature-package.md) used to show —

```ts
if (error.message.includes("two-factor")) onNeedsTwoFactor?.();
```

That breaks when someone rewords the copy, and it was already broken in every locale but English,
because the sentence a user sees comes from `content`. A code cannot be reworded.

---

# `HTTP_STATUS`

```ts
export const HTTP_STATUS: Readonly<Record<ErrorCode, number>>;
```

`Record<ErrorCode, number>` is **total**, so adding a code fails to compile until it has a status. A
test additionally asserts the two maps have not drifted in either direction, which the type cannot see:

```ts
expect(Object.keys(HTTP_STATUS).sort()).toEqual(Object.keys(ERROR_CATALOG).sort());
```

## Why it lives in `transport/` and who may not import it

`ForbiddenError` is a domain concept; `403` is a transport concept. Keeping the domain layer ignorant of
the number is most of what makes the transport swappable —
[12](../../../../docs/setup/12-application-package.md) states it, and a NestJS exception filter mapping
the same `code` to `ForbiddenException` is the proof.

That used to be enforced by a package boundary: status codes lived in `apps/web` and `application`
simply could not reach them. Now both live here, so a lint rule holds the line instead:

```js
{
  files: ["packages/application/src/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{
        name: "@loadbearing/errors",
        importNames: ["HTTP_STATUS"],
        message: "A status code is a transport concern. Throw the error; the adapter maps it.",
      }],
    }],
  },
}
```

Same mechanism, same file, as the ban that stops `content` importing `PermissionKey`
([20](../../../../docs/setup/20-content-package.md)). Note it bans the **import name**, not the module:
`application` imports `ForbiddenError` from this package constantly.

Two statuses are shared, which is fine — `UNAUTHORIZED` and `TWO_FACTOR_REQUIRED` are both `401`. The
distinction that matters to the client is the code, and it has it.

---

## Adding a code

Three edits, and the compiler finds the fourth:

1. A fragment in `catalog/`, or a new entry in `core.errors.ts` if it is genuinely shared.
2. `HTTP_STATUS` — fails to compile until you do.
3. `ERROR_COPY` in `content` — also fails to compile until you do, so a code cannot ship without a
   sentence ([20](../../../../docs/setup/20-content-package.md)).

Most slices need none of this. Failing as `FORBIDDEN`, `NOT_FOUND` or `CONFLICT` is the norm; reach for
a slice-specific code only when a caller would genuinely branch on it differently.

---

## See also

- [`@loadbearing/errors`](../index.md)
- [AppError](app-error.md) — where `ErrorCode` is consumed
- [ErrorNormalizer](error-normalizer.md) — what guarantees a valid code
