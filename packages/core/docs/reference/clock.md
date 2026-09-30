---
title: clock
description: Clock, SystemClock and FixedClock — why time is an injected dependency, and the one rule that makes every time-dependent business rule synchronously testable.
---

# `Clock`

```ts
export abstract class Clock {
  public abstract now(): Date;
}

export class SystemClock extends Clock {
  public override now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  public constructor(private readonly fixed: Date) {
    super();
  }

  public override now(): Date {
    return this.fixed;
  }

  public advance(ms: number): FixedClock {
    return new FixedClock(new Date(this.fixed.getTime() + ms));
  }
}
```

---

## The rule

> [!IMPORTANT]
> **No code anywhere in `packages/` calls `Date.now()` or `new Date()` to make a decision.**
> Take a `Clock` and call `now()`.
>
> Formatting a timestamp for display is not a decision. Comparing one to a deadline is.

The single exception in the whole codebase is `Uuid.v7()`, which reads `Date.now()` to build the
time-ordered prefix of an identifier. It lives one file over, inside `core` itself, and it is not
making a business decision.

---

## Why this is not over-engineering

`new Date()` is three characters shorter, so the abstraction has to pay for itself. It does, by
volume: count what in a real product is time-dependent.

- deadlines and overdue detection
- SLA thresholds and escalation windows
- review-integrity windows
- token expiry and refresh
- cache TTLs
- rate-limit buckets

Every one of those is a rule, every rule needs a test, and testing a rule against the real system
clock leaves two options: sleep in the test, or accept that it is flaky. `FixedClock` makes
"does this task go overdue at exactly midnight" a synchronous assertion with no timers involved.

```ts
const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
const task = Task.dueAt(new Date("2026-01-01T00:00:00.001Z"));

expect(task.isOverdue(clock)).toBe(false);
expect(task.isOverdue(clock.advance(2))).toBe(true);
```

---

## `advance()` returns a new instance

```ts
public advance(ms: number): FixedClock {
  return new FixedClock(new Date(this.fixed.getTime() + ms));
}
```

Not `this.fixed = …`. A mutable clock shared between two assertions in the same test is its own
source of confusion — the second assertion depends on whether the first one ran, and a reordered
or `.only`-ed test starts failing for reasons that have nothing to do with the rule under test.

Returning a new instance also reads better at the call site, because the two clocks can sit in the
same expression:

```ts
expect(task.isOverdue(clock)).toBe(false);
expect(task.isOverdue(clock.advance(2))).toBe(true);
```

---

## Why an abstract class and not an interface

Every *port* in this codebase is an abstract class. ([`Result`](result.md) is a union, but it is a
return value, never an injected dependency — the reasoning below does not apply to it.) The reason is
[`verbatimModuleSyntax`](../../../../tooling/tsconfig/docs/reference/base.md): an interface is
erased at compile time and cannot be a constructor-injection token, so it would need a separate
runtime symbol to bind against. An abstract class is one declaration that is both the type and the
token.

The ESLint OOP rules in [`@loadbearing/eslint-config`](../../../../tooling/eslint-config/docs/index.md)
enforce the same shape across the packages that follow this pattern.

---

## `SystemClock` vs `FixedClock`

| | Where it is constructed |
| --- | --- |
| `SystemClock` | once, in the composition root — see [17 · composition](../../../../docs/setup/17-composition-container.md) |
| `FixedClock` | in tests, per test |

Nothing else constructs a clock. A use-case that reaches for `new SystemClock()` has just
undone the abstraction.

---

## Tests

`tests/clock.spec.ts` asserts the two properties that matter — that `now()` is fixed, and that
`advance()` does not mutate:

```ts
it("advances without mutating", () => {
  const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
  const later = clock.advance(60_000);

  expect(later.now().toISOString()).toBe("2026-01-01T00:01:00.000Z");
  expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
});
```

---

## See also

- [`@loadbearing/core`](../index.md)
- [Result](result.md) · [Uuid](uuid.md) · [ServerOnly](server-only.md)
