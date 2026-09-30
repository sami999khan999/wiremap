---
title: error-normalizer
description: ErrorNormalizer — why detection is structural rather than instanceof, and how the original error is kept for logs while staying out of the envelope.
---

# `ErrorNormalizer`

```ts
export class ErrorNormalizer {
  public static normalize(thrown: unknown): AppError;
}
```

Every thrown value crosses this before it is transported, logged, or rendered. After it, the shape is
known — which is what lets the oRPC interceptor be three lines with no fall-through branch to get wrong.

```ts
ErrorNormalizer.normalize(new ForbiddenError("x"));      // itself
ErrorNormalizer.normalize(zodError);                     // ValidationError
ErrorNormalizer.normalize(new Error("pg: relation …"));   // InternalError
ErrorNormalizer.normalize("boom");                       // InternalError
ErrorNormalizer.normalize(undefined);                    // InternalError
```

`normalize` is **total**. `throw "boom"` and a promise rejected with `undefined` are both real things
that happen, and a normaliser that only handles `Error` subclasses is the reason production stack traces
sometimes say `undefined`.

---

## Detection is structural, not `instanceof`

```ts
private static isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; toJSON?: unknown };

  return (
    typeof candidate.code === "string" &&
    AppError.isKnownCode(candidate.code) &&
    typeof candidate.toJSON === "function"
  );
}
```

Two copies of this package in one process — a hoisting quirk, a bundled dependency, an SSR/client
boundary — produce two distinct class identities, and `instanceof` silently answers `false` for an error
that is obviously ours. It then gets collapsed to `INTERNAL`, the client sees "Something went wrong"
instead of "You do not have permission", and nothing anywhere logs a warning.

This is the same reasoning [12](../../../../docs/setup/12-application-package.md) gives for switching on
a closed `code` vocabulary rather than a class check, applied one level down. A known `code` plus a
callable `toJSON` survives duplicate identities. There is a test for exactly this — an object literal
shaped like one of ours normalises to its own code, and one carrying an unknown code does not.

---

## Zod is matched by shape, not imported

```ts
private static isSchemaError(value: unknown): value is { issues: readonly SchemaIssue[] };
```

This package has zero dependencies, and importing `zod` to narrow one branch would end that. So a
Zod-shaped error is anything with an `issues` array whose entries have a `path` array and a string
`code` — which is Zod's contract in practice, and which also means any other validator with the same
shape normalises for free.

`SchemaIssue` declares only the four fields used: `path`, `code`, `minimum`, `maximum`. **Both
bounds travel when an issue carries both** — a `min(8).max(64)` string produces `{ min, max }`, and a
template that names only one simply ignores the other. Returning at the first bound found lost `max`
on every such issue, and `error.field.tooLong` renders an unmatched `{max}` literally.

---

## The original is kept for logs and cannot reach the envelope

```ts
export class InternalError extends AppError {
  public override readonly cause: unknown;

  public constructor(cause?: unknown) {
    super("INTERNAL");
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}
```

**Non-enumerable is the load-bearing word.** A log adapter can read `error.cause` and record the real
failure; `JSON.stringify` skips it, and `toJSON()` never names it. That is what keeps a Postgres error
string — which cheerfully contains your table names — from travelling to a client, and it closes the
hole at the normaliser rather than relying on every adapter to remember.

Asserted directly rather than assumed:

```ts
const secret = 'connection to db-prod-01 refused: relation "user_api_keys" does not exist';
const normalized = ErrorNormalizer.normalize(new Error(secret));

expect(JSON.stringify(normalized.toJSON())).not.toContain("user_api_keys");
expect(JSON.stringify(normalized)).not.toContain("db-prod-01");
expect(normalized.cause).toBeInstanceOf(Error);   // still there for the logger
```

`override` is required on `cause` because `Error.cause` exists in the ES2022 lib —
`noImplicitOverride` catches its absence.

---

## Rule names, never library tokens

Zod issue codes are an open set and change between majors, so an unrecognised one becomes `"invalid"`
rather than leaking `some_future_zod_code` into an envelope that `content` then has no copy for:

| Zod issue code | `rule` |
| --- | --- |
| `invalid_type` | `required` |
| `too_small` | `tooShort` |
| `too_big` | `tooLong` |
| `invalid_format`, `invalid_string` | `invalidFormat` |
| anything else | `invalid` |

`FIELD_RULE_COPY` in `content` is therefore deliberately *not* total, unlike `ERROR_COPY` — an unknown
rule falls back to `error.unexpected`.

---

## See also

- [`@loadbearing/errors`](../index.md)
- [AppError](app-error.md) — the shape this produces
- [24 · `apps/web`](../../../../docs/setup/24-web-app.md) — the interceptor that consumes it
