---
title: app-error
description: AppError — why the message is the code, how the envelope round-trips, and why from() can return null.
---

# `AppError`

```ts
export type ErrorContext = Readonly<Record<string, string | number | boolean>>;

export interface FieldViolation {
  readonly field: string;
  readonly rule: string;   // → a MessageKey in content, never a sentence
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly context: ErrorContext;
  readonly fields?: readonly FieldViolation[];
  readonly traceId?: string;
}

export abstract class AppError extends Error {
  public constructor(code: ErrorCode, context?: ErrorContext, fields?: readonly FieldViolation[]);

  public readonly code: ErrorCode;
  public readonly context: ErrorContext;
  public readonly fields?: readonly FieldViolation[];

  public get retryable(): boolean;
  public toJSON(): ErrorEnvelope;

  public static isKnownCode(value: string): value is ErrorCode;
  public static from(envelope: ErrorEnvelope): AppError | null;
}

export class TransportError extends AppError {}

// The wire's trace id, bounded and character-checked. `Correlation.sanitise` in
// observability is a delegating alias — this is the one copy of the rule.
export class TraceIds {
  public static readonly MAX_LENGTH: number;
  public static sanitise(value: string | null | undefined): string | null;
}
```

---

## The code is passed to `super()`, and that is the whole trick

```ts
public constructor(
  public readonly code: ErrorCode,
  public readonly context: ErrorContext = {},
  public readonly fields?: readonly FieldViolation[],
) {
  super(code);
  …
}
```

`super(code)` makes `Error.message` the code, with nothing to strip and nothing to translate. The first
draft of this class declared `code` abstract and overrode `message` with a getter — which does not
typecheck, because `Error.message` is a mutable property and a get-only accessor is not assignable to
one. Taking the code as a constructor parameter is simpler *and* it means a subclass cannot forget:

```ts
export class ForbiddenError extends AppError {
  public constructor(permission: string, goalId?: string) {
    super("FORBIDDEN", goalId ? { permission, goalId } : { permission });
  }
}
```

`{ permission, goalId }` is what a log query wants and what `content` interpolates. There is no third
representation to keep in sync.

---

## `Error.captureStackTrace` is not in the standard library

```ts
type StackTraceCapture = {
  captureStackTrace?: (target: object, constructorOpt?: unknown) => void;
};

(Error as StackTraceCapture).captureStackTrace?.(this, new.target);
```

`captureStackTrace` is a V8 extension, so `lib: ["ES2024"]` does not declare it and a bare
`Error.captureStackTrace?.(…)` fails with `TS2339` — verified. This is the same situation as `crypto`
in [`@loadbearing/core`](../../../core/docs/reference/uuid.md), and the same answer: name the one method
you use, reach it off the value, and stay independent of whether `@types/node` ever lands in the
program. The optional call keeps it correct where V8 is absent.

> The build listing in [12](../../../../docs/setup/12-application-package.md) originally wrote the bare
> form. It is corrected there.

---

## `from()` returns `null`, and callers must handle it

An envelope arrives from the wire, a Redis entry, or a queue payload — all untrusted. So the code is
checked rather than trusted:

```ts
AppError.from({ code: "MADE_UP", context: {} }); // null
```

This is the same boundary `CapabilitySet.from()` enforces, and `isKnownCode` uses `Object.hasOwn` for
the same reason `PermissionRegistry.isKnown` does: `"constructor" in ERROR_CATALOG` is `true`, and an
inherited property would resolve to a `retryable` of `undefined`.

What comes back is a `TransportError` — the code and context survive, the original class does not. That
is deliberate and sufficient: callers switch on `code`, never on `instanceof`.

**The trace id is checked on the same grounds, and used to be adopted verbatim.** It is a string from
the same untrusted envelope, and once adopted it rides every log line that mentions the error — the
log-injection primitive `Correlation.sanitise` exists to prevent on the request path, reachable by a
second door. `from()` now applies the identical rule and drops what fails it:

```ts
AppError.from({ code: "INTERNAL", context: {}, traceId: 'x" level=error' }); // no traceId
AppError.from({ code: "INTERNAL", context: {}, traceId: "a".repeat(500) })
  ?.toJSON().traceId?.length;                                               // 128
```

Over-long is truncated rather than dropped, because an over-long id is still probably the upstream's
and half a trace is more use than none; a wrongly *shaped* one is discarded outright, because there
is nothing in it worth keeping.

**The rule lives in `TraceIds`, in this package, and `Correlation.sanitise` delegates to it.** Two
copies of a bound-and-charset check is exactly the pair that drifts, and the direction of the
dependency decides which package holds it: `observability` may import `errors`, never the reverse.

---

## `fields` is omitted rather than empty

```ts
new ForbiddenError("x").toJSON(); // { code, context } — no `fields` key
```

An absent key and an empty array both mean "no field violations", but only one of them stays absent
through a JSON round-trip without inviting `fields.length` on a non-validation error.

---

## The subclasses, and what each carries

A class exists for a code when a use-case needs to **throw** it with context. `RATE_LIMITED` and
`UNAVAILABLE` have none, because a rate limiter and a health check are adapters.

| Class | Code | Context |
| --- | --- | --- |
| `UnauthorizedError` | `UNAUTHORIZED` | `{ reason }`, defaulting to `"no-session"` |
| `ForbiddenError` | `FORBIDDEN` | `{ permission }`, plus `goalId` when scoped |
| `NotFoundError` | `NOT_FOUND` | `{ resource, id }` |
| `ConflictError` | `CONFLICT` | `{ resource, reason }` |
| `TwoFactorRequiredError` | `TWO_FACTOR_REQUIRED` | — |
| `ValidationError` | `BAD_REQUEST` | `{ fieldCount }` + `fields` |
| `InternalError` | `INTERNAL` | — (the original is held on a non-enumerable `cause`) |
| `ServerOnlyError` | `SERVER_ONLY` | `{ package }` |
| `TransportError` | any | whatever the envelope carried |

### `ServerOnlyError` is the one thrown before anything else runs

```ts
// packages/core/src/primitive/server-only.ts
throw new ServerOnlyError(packageName);
```

`ServerOnly.assert` fires at module load, in a browser, in a build that is already broken. It is the
hardest case in the repository for "an error carries no message" — a developer-facing string, read
from a console, that never crosses a wire — and it still carries only a code.

The context key is **`package`**, not `packageName`, because that key *is* the `{package}` placeholder
in `error.serverOnly` over in `content`. Renaming it breaks nothing except the rendered sentence,
which is why a test asserts the key list directly.

The full argument, including the case *for* an exception and why it fails, is on
[core's `ServerOnly` page](../../../core/docs/reference/server-only.md#why-the-hardest-case-for-prose-still-loses).

---

## See also

- [`@loadbearing/errors`](../index.md)
- [ErrorNormalizer](error-normalizer.md) — how anything thrown becomes one of these
- [catalog](catalog.md) — where `ErrorCode` and `retryable` come from
- [`ServerOnly`](../../../core/docs/reference/server-only.md) — the one caller that throws at module load
- [`content`'s `ERROR_COPY`](../../../content/docs/reference/error-copy.md) — where the words are
