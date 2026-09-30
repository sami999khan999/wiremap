---
title: logger
description: The seam, why it returns void rather than a promise, what failure() reads off an AppError, and where the redaction line sits.
---

# `Logger`

```ts
export abstract class Logger {
  protected abstract write(entry: LogEntry): void;
  public abstract child(bound: LogFields): Logger;

  public emit<C extends EventCode>(code: C, fields: EventFields<C>): void;
  public failure(thrown: unknown, fields?: LogFields): void;
  public threshold(): LogLevel;
}

export class JsonLogger extends Logger {}    // stdout → Alloy → Loki, the default
export class SilentLogger extends Logger {}  // TestContainer, and logging genuinely off
```

---

## `void`, not `Promise<void>`

Every other seam in this system is async — `ContentSource` is async even where its implementation is
not, and doc 29 lists a synchronous read method as a smell. This one breaks that rule on purpose.

An async logger makes a log line a scheduling decision. Every call site must `await` it or `void` it,
`no-floating-promises` fires on all of them, and the natural fix — `void log.emit(...)` everywhere —
is noise on lines that exist to reduce noise. Worse, an awaited log in a hot path reorders the work
around it.

A logger writes to a file descriptor and moves on. Losing a line during a crash is acceptable, which
is exactly what separates this from `ActivityLogger`, where it is not. **Do not "fix" this to match the
other ports** — the difference is the point.

## `emit` is concrete, `write` is abstract

Level filtering, sampling, bound-field merging, and redaction all happen in the base class before
`write` is called. An implementation receives a `LogEntry` that has already survived every policy
decision, and serialises it.

Same reasoning as `ContentSource.resolve()` being `protected static`: it makes "the threshold is
respected" a property of the seam rather than something each sink has to remember. A third
implementation cannot get it wrong.

## `failure()` reads what the wire cannot

```ts
public failure(thrown: unknown, fields: LogFields = {}): void
```

The path every caught error takes. Four things happen in order:

**1. Normalised first.** `ErrorNormalizer.normalize()` turns an unrecognised throw into an
`InternalError`, so `failure("something fell over")` produces a real line instead of a shrug. The
structural check means it works across two copies of `@loadbearing/errors` in one process.

**2. Level from severity.** `ERROR_CATALOG[code].severity` decides: `expected → warn`,
`unexpected → error`. A `FORBIDDEN` is the system working; an `INTERNAL` is not. Only one should
wake anybody, and that decision was already made next to the code — see
[errors · catalog](../../../errors/docs/reference/catalog.md).

**3. Context flattened.** `error.context` is already `Record<string, string | number | boolean>` —
the same value types a log field takes, because both were designed for the same job. It spreads
straight in. `error.fields` is an array, so it collapses to `violations: "email,password"`; the
rules and params already reached the user in the response.

**4. The cause, which is the whole point.** `InternalError` keeps the original throw on a
**non-enumerable** `cause`, so `JSON.stringify` skips it and `toJSON()` never names it. That is what
stops a Postgres error string — which cheerfully contains your table names — from reaching a client.
A logger is the one reader allowed to see it, and this is where it does.

```ts
logger.failure(new InternalError(new Error('relation "users" does not exist')));
// {"level":"error","event":"error.raised","code":"INTERNAL",
//  "cause":"Error: relation \"users\" does not exist","stack":"…"}
```

**The stack is attached only for `unexpected`.** An expected failure is the system working, and its
stack is noise on every 403 the product serves. It is also truncated: enough frames to find the
throw, short enough that a retry storm does not become the whole bill.

## `child()` is how a trace id rides

```ts
const scoped = logger.child({ traceId });
```

Bound fields merge into every line the child writes, and the child does not leak back into the
parent. Nesting works, and the innermost binding wins.

This is deliberately *not* ambient state. `AsyncLocalStorage` would be Node-only — this package runs
in the Tauri webview too — and doc 17 rule 2 forbids request-scoped state on the `Container`. A
child logger passed down the same path as the `Principal` gets the same result with nothing hidden.

## Redaction is a backstop, not the defence

`Redactor` matches on the field *name*, lowercased and stripped of separators, against a substring
list: `token`, `password`, `secret`, `authorization`, `cookie`, `credential`, `apikey`, `sessionid`,
`passphrase`, `privatekey`. A hit replaces the value with `[redacted]` and keeps the key, so the
shape of the line stays stable.

Substring, not prefix: a prefix list misses `userToken`, an exact list misses `x-api-key`.

It runs on every line, so the no-hit case returns the original object rather than a copy. And it is
the *second* line of defence — `EventShape` is the first, because a field nobody declared cannot be
logged at all. This catches what a `child()` binding drags in, where the type is a bare `LogFields`.

It exists because doc 16 says *"redact at the logger, not at each call site — a rule enforced in one
place holds."*
