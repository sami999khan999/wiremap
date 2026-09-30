# 07 · `@loadbearing/core`

> The smallest package, written first to prove the build pipeline end to end. Four primitives and nothing else.

**Delivers:** `Clock`, `Result`, `Uuid`, `ServerOnly`.

**Prerequisite:** [06 · Package Anatomy](06-package-anatomy.md)

---

## What belongs here

Only things that (a) every other package might need and (b) belong to no feature. The bar is deliberately high, and every addition here is something that can never be tested with a fake.

**One dependency, and only one:** [`@loadbearing/errors`](09-errors-package.md), because `ServerOnly.assert` throws ([Step 7.4](#step-74--serveronly)) and nothing in this repository throws a bare `Error`. `errors` is itself a zero-dependency leaf, so `core` stays loadable in a browser, a Node worker, a Tauri webview, or a bare test file — which is the property that actually matters, not the edge count.

```
packages/core/
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── clock.ts          → Clock, SystemClock, FixedClock
│   ├── result.ts         → Result, Ok, Err, Results
│   ├── uuid.ts           → Uuid
│   └── server-only.ts    → ServerOnly
└── tests/
    ├── clock.spec.ts
    ├── result.spec.ts
    ├── server-only.spec.ts
    └── uuid.spec.ts
```

---

## Step 7.1 — `Clock`

**`packages/core/src/primitive/clock.ts`**

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

This looks like over-engineering for `new Date()` until you count how much of a real product is time-dependent: deadlines, overdue detection, SLA thresholds, review integrity windows, token expiry, cache TTLs, rate-limit buckets. Every one of those rules needs testing, and testing them against the real system clock means either sleeping in tests or accepting flaky ones.

`FixedClock` makes "does a task go overdue at exactly midnight" a synchronous assertion. `advance()` returns a new instance rather than mutating, because a mutable clock shared between two assertions in the same test is its own source of confusion.

**The rule:** no code anywhere in `packages/` calls `Date.now()` or `new Date()` for a decision. Formatting a display string is fine; deciding whether something is overdue is not.

---

## Step 7.2 — `Result`

**`packages/core/src/primitive/result.ts`**

```ts
// The shared behaviour of both cases. Not exported — `Result` is the union below,
// and that is what call sites annotate with. Only the union narrows in every
// position; an abstract base class narrows a positive `instanceof` and nothing else,
// because TypeScript can subtract a member from a union but not from a class.
abstract class ResultBase<T, E> {
  public abstract unwrapOr(fallback: T): T;
  public abstract mapOk<U>(fn: (value: T) => U): Result<U, E>;
  public abstract mapErr<F>(fn: (error: E) => F): Result<T, F>;
}

export class Ok<T, E> extends ResultBase<T, E> {
  public readonly kind = "ok" as const;

  public constructor(public readonly value: T) {
    super();
  }

  public override unwrapOr(_fallback: T): T {
    return this.value;
  }

  public override mapOk<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  public override mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value);
  }
}

export class Err<T, E> extends ResultBase<T, E> {
  public readonly kind = "err" as const;

  public constructor(public readonly error: E) {
    super();
  }

  public override unwrapOr(fallback: T): T {
    return fallback;
  }

  public override mapOk<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error);
  }

  public override mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }
}

export type Result<T, E> = Ok<T, E> | Err<T, E>;

// Factories. A type alias cannot carry statics, so these live on their own class
// rather than on `Result` — the one cost of making `Result` a union.
export class Results {
  private constructor() {}

  public static ok<T, E = never>(value: T): Result<T, E> {
    return new Ok(value);
  }

  public static err<E, T = never>(error: E): Result<T, E> {
    return new Err(error);
  }
}
```

### Why `Result` is a union and not an abstract class

Every other port in this codebase is an abstract class, so this one being a `type` is worth
justifying. It is the only shape that narrows.

An earlier draft of this file had `Result` as an abstract base with `isOk`/`isErr` boolean getters.
Those getters cost twenty-two lines and bought nothing:

```ts
if (parsed.isOk) {
  parsed.value; // ✗ Property 'value' does not exist on type 'Result<number, string>'
}
```

Switching them to type predicates (`isOk(): this is Ok<T, E>`) fixes the positive branch and
nothing else. Verified against this repo's compiler flags:

| Position | abstract class | union |
| --- | --- | --- |
| `if (r.isOk()) { r.value }` | ✅ | ✅ |
| the `else` branch | ❌ stays `Result<T, E>` | ✅ narrows to `Err` |
| fall-through after `if (r.isErr()) return` | ❌ | ✅ |
| negative branch of `instanceof` | ❌ | ✅ |
| `switch (r.kind)` with no `default` | ❌ not exhaustive | ✅ exhaustive |

The reason is structural: **TypeScript can subtract a member from a union, but not from a class.**
`Result<T, E>` as a class has no "everything except `Ok`" to narrow to. As
`Ok<T, E> | Err<T, E>` it does.

So the accessors are gone entirely — `r.kind === "ok"` is the branch, and it narrows both ways.
`ResultBase` stays as an unexported abstract class purely to hold the three shared method
signatures; it never appears in a public type.

> [!NOTE]
> **The one cost is the factory name.** A type alias cannot carry statics, so `Result.ok(…)`
> becomes `Results.ok(…)`. That is the whole price. The factories exist rather than bare
> `new Ok(1)` because `E` is unconstrained by the constructor and would infer as `unknown`.

`ResultBase` is deliberately not exported, and `tsup` emits it as a local `declare abstract class`
that no public signature mentions.

### When to use `Result` and when to throw

This distinction matters, and getting it wrong produces either an exception-driven codebase or one where every call site has three lines of unwrapping.

| Situation | Use |
|---|---|
| Operation fails as part of normal business flow — validation, a lookup that legitimately misses, a parse of untrusted input | `Result` |
| An invariant is violated — the caller lacks permission, a referenced row must exist and doesn't, a config value is absent | **throw** a domain error from `application/error/` |

`ForbiddenError` throws. `NotFoundError` throws. A repository's `findByIdOrFail` throws. Those are all cases where the caller has no meaningful recovery and the transport adapter should map them to a status code.

`Result` is for cases where the caller *does* branch, and the discriminated return type makes the branch impossible to forget. `noUncheckedIndexedAccess` and `strict` give you most of that already, so `Result` should be the minority pattern. If it starts appearing everywhere, the codebase is drifting toward exception-free purism and away from readable use-cases.

---

## Step 7.3 — `Uuid`

**`packages/core/src/primitive/uuid.ts`**

```ts
// The one Web Crypto method this package uses.
//
// `library.json` sets `lib: ["ES2024"]` with no DOM, so `crypto` is not a declared
// identifier in this package. It happens to resolve today because `tests/clock.spec.ts`
// imports vitest, which pulls vite's `/// <reference types="node" />` and with it
// the `@types/node` globals into the program — so deleting the tests, or dropping
// `tests/**` from this package's tsconfig `include`, would stop `Uuid` from
// compiling. Naming the method and reaching it off `globalThis` makes the type
// independent of whatever else lands in the program.
type WebCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

export class Uuid {
  private constructor() {}

  private static webCrypto(): WebCrypto {
    return (globalThis as unknown as { crypto: WebCrypto }).crypto;
  }

  // UUIDv7 — time-ordered. Sequential inserts stay on the right-hand side of the
  // B-tree instead of scattering across it, which is worth a lot on a table
  // that only ever grows.
  public static v7(): string {
    const ts = BigInt(Date.now());
    const bytes = Uuid.webCrypto().getRandomValues(new Uint8Array(16));
    for (let i = 0; i < 6; i++) {
      bytes[i] = Number((ts >> BigInt(40 - i * 8)) & 0xffn);
    }
    // Version 7 into the high nibble of byte 6, RFC 9562 variant into the top two
    // bits of byte 8. The `?? 0` can never fire — a Uint8Array(16) always has both
    // indices — but `noUncheckedIndexedAccess` types the read as possibly-undefined
    // and this discharges it without a non-null assertion.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // A shape guard for untrusted input, not a version assertion — a v4 minted
  // elsewhere is still an identifier. `[1-8]` is every version RFC 9562 defines.
  public static isValid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
```

> [!IMPORTANT]
> **`crypto` is not a global this package can see.** TypeScript declares it only in
> `lib.dom.d.ts` and `lib.webworker.d.ts`, and `library.json` loads neither. Written as a bare
> `crypto.getRandomValues(...)` the file compiles *by accident*: `tests/clock.spec.ts` imports
> vitest, vitest's types pull in vite's, and vite carries `/// <reference types="node" />`. Delete
> the spec file and `Uuid` stops compiling with `TS2304: Cannot find name 'crypto'` — verified.
>
> This accident survives tests living in `tests/` rather than `src/` *only* because the tsconfig
> `include` lists `tests/**` alongside `src/**`, keeping both in one program. Drop that glob and
> the bare-`crypto` form fails again — also verified.
>
> Adding `@types/node` would fix it and cost more than it saves: `core` is the one package that
> must typecheck as isomorphic, and `@types/node` would also make `process` and `Buffer`
> resolve here. The four-line `WebCrypto` type is the smaller commitment.

**Why v7 rather than v4.** Every primary key in the schema is a UUID. Random v4 keys mean each insert lands at a random point in the index, so the B-tree fragments and the working set is the whole index rather than its tail. v7 embeds a millisecond timestamp in the high bits, so inserts are append-mostly and rows created together sit together on disk. On a table with a few hundred thousand rows the difference is measurable; on a few million it is the difference between a fast insert path and a slow one.

The side effect — IDs leak creation time — is worth knowing about. It is fine for internal identifiers and worth avoiding for anything a customer sees in a URL where enumeration order matters.

`crypto.getRandomValues` is the Web Crypto API, global in Node 19+ and in every browser. No import, no polyfill, and it works in a Tauri webview.

---

## Step 7.4 — `ServerOnly`

**`packages/core/src/primitive/server-only.ts`**

```ts
import { ServerOnlyError } from "@loadbearing/errors";

export class ServerOnly {
  private constructor() {}

  // Call at the top of every server-only package barrel.
  public static assert(packageName: string): void {
    // `library.json` sets lib: ["ES2024"] with no DOM, so a bare `window` is an
    // unresolved identifier (TS2304) even behind `typeof`. Reaching it as an
    // optional property of `globalThis` is the same runtime check, expressed in
    // a way a package that has never heard of a browser can compile.
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
      // No message. The sentence a developer needs lives in `@loadbearing/content`
      // as `error.serverOnly`, keyed off this code and interpolated from
      // `{ package: packageName }` — see [09](09-errors-package.md).
      throw new ServerOnlyError(packageName);
    }
  }
}
```

Three packages call this on their first line: `infrastructure`, `auth`, `composition`.

```ts
// packages/infrastructure/src/index.ts
import { ServerOnly } from "@loadbearing/core";
ServerOnly.assert("@loadbearing/infrastructure");
```

Note the check goes through `globalThis` rather than naming `window` directly. `library.json` sets `lib: ["ES2024"]` with no DOM, so `window` is not a known identifier in this package.

> [!WARNING]
> **A bare `typeof window !== "undefined"` does not compile here.** TypeScript's `typeof` guard
> only tolerates a *declared* binding that might be `undefined` at runtime; on a name it has
> never heard of it still reports `TS2304: Cannot find name 'window'` — verified. Widening
> `globalThis` to `{ window?: unknown }` is the same runtime test with a type the compiler can
> resolve, and it needs neither the DOM lib nor an ambient `declare` that would collide with
> `@types/node` wherever both land in one program.

This is the second of three defences. The ESLint `no-restricted-imports` boundary ([05](05-lint-and-format.md)) is the first and catches the mistake at authoring time. This one catches it at runtime if someone adds an escape-hatch path. The CI bundle grep ([26](26-hygiene-and-ci.md)) catches it at build time if both are somehow bypassed.

Three feels like a lot for one mistake. It is calibrated to the cost: a Drizzle import reaching the client ships your connection string and full table shapes to anyone who opens devtools.

### There is no error in this repository that carries a message

[09](09-errors-package.md) establishes that an error carries a **code and structured context, never prose** — every word a user reads lives in `content` ([20](20-content-package.md)), keyed and translated. `ServerOnly.assert` is where that rule is easiest to argue an exception for, and it does not get one. The rule holds without a single carve-out, which is worth more than the sentence it costs.

The tempting argument for an exception, and why it loses:

| The case for prose here | Why it does not hold |
| --- | --- |
| The audience is a developer at module load — no request, no locale, no `Translator`. | True, and irrelevant: the reader still needs the *words*, and `content` is where words are. What the throw site needs is the code and the package name. |
| The prose *is* the payload — "this is a leak, not a bundle-size problem" is what stops someone reaching for a bundler setting. | Still is. It moved to `error.serverOnly` in `content`, with `{package}` interpolated from the error's context, so an error boundary and a console reader get the identical sentence — and a Bengali-reading developer can get it in Bengali. |
| It never crosses a wire, so none of the reasons for keeping text out of errors apply. | One reason still applies, and it is the one that matters: a `message` field on the base class is the thing that gets rendered. Leave it available for the honest case and it will be used for the dishonest one. |

So `ServerOnly.assert` throws `ServerOnlyError` — code `SERVER_ONLY`, context `{ package }`, and `Error.message` equal to `"SERVER_ONLY"` like every other error in the build.

```
ServerOnlyError: SERVER_ONLY
    at ServerOnly.assert (…)
    at packages/infrastructure/src/index.ts:2:12
```

That is a legible stack trace: it names the guard, and the frame below it names the package that leaked. The sentence is one `ERROR_COPY` lookup away.

> [!NOTE]
> **This is why `core` declares `@loadbearing/errors`.** The two packages are presented in this order
> because `core`'s primitives are what a reader needs first, not because there is a layer between them —
> `errors` is a zero-dependency leaf and the edge is acyclic. `pnpm build:packages` reads the graph, not
> the doc numbers, so it builds `errors` first; if your build log shows `core` first, the dependency is
> missing from `packages/core/package.json`.
>
> An earlier revision of this document declared the exception and told you not to "fix" it by inverting
> the two packages. Inverting them was the fix.

**`permissions` ([08](08-permissions-package.md)) throws nothing at all by design** — an unknown permission is denied, not raised — so `ServerOnlyError` is the only error thrown anywhere in docs 07–08.

---

## Step 7.5 — The two barrels

`src/` holds `index.ts`, `import.ts`, and folders — nothing else
([Opinions · Folders](../opinions/folders.md)). All four primitives live in `primitive/`, so this
package has one folder and two barrels.

**`packages/core/src/primitive/index.ts`**

```ts
export { Clock, FixedClock, SystemClock } from "./clock.js";
export { Err, Ok, type Result, Results } from "./result.js";
export { ServerOnly } from "./server-only.js";
export { Uuid } from "./uuid.js";
```

**`packages/core/src/index.ts`**

```ts
export {
  Clock,
  Err,
  FixedClock,
  Ok,
  type Result,
  Results,
  ServerOnly,
  SystemClock,
  Uuid,
} from "./primitive/index.js";
```

The root barrel names only folder barrels. The scaffold's `export {};` is replaced here — the
placeholder class the earlier draft of this document kept until [24](24-web-app.md) is gone, and
[24](24-web-app.md) proves the workspace→bundler chain with `Clock` instead.

**Every export is named; `export *` is a lint error** ([Opinions · Imports](../opinions/imports.md)). `Result` is a type alias, so it carries the inline `type` modifier and stays erased under `verbatimModuleSyntax`. `ResultBase` never appears, which here costs nothing because it was never exported from `result.ts` either — but that is the point of the named list: once a sibling file legitimately needs a symbol and `export` goes on it, the barrel is what decides whether the rest of the repository sees it.

**Two barrels rather than one is the shape every package has**, and the reason is that the root
barrel then changes only when the *public surface* changes. Moving `clock.ts` from `primitive/` to
a future `time/` touches `primitive/index.ts` and `index.ts` and nothing else in the repository.

---

## Step 7.6 — A first test

**`packages/core/tests/primitive/clock.spec.ts`**

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "../src/clock.js";

describe("FixedClock", () => {
  it("returns the fixed instant", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(new FixedClock(at).now()).toEqual(at);
  });

  it("advances without mutating", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    const later = clock.advance(60_000);

    expect(later.now().toISOString()).toBe("2026-01-01T00:01:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
```

Tests live in a per-package **`tests/`** directory, named `<subject>.spec.ts`, mirroring the `src/` tree they cover. Not colocated in `src/`, not in a `__tests__/` directory, and not in one repo-wide `test/` folder.

Per-package rather than repo-wide because each package owns its own `vitest.config.ts` and `test` script, and the root `pnpm -r --parallel run test` fans out to them — a single root config would have to be re-split the moment `ui` needs jsdom or `infrastructure` needs a live Postgres. Outside `src/` rather than beside it so `src/` is exactly the shipped surface: `tsup` builds from `src/index.ts` and the `development` export condition points into `src/`, and neither should be able to reach a spec file. The cost is that a subject and its test are no longer adjacent; the mirrored layout is what pays for it — `src/clock.ts` is tested by `tests/clock.spec.ts`, always.

One consequence to keep in mind: `tests/**` has to stay in the package's tsconfig `include`, or `tsc --noEmit` silently stops typechecking the tests.

Add one for `Uuid` too — it is the only primitive here whose behaviour is not obvious by reading it, and `vi.setSystemTime` makes the timestamp claim testable rather than assumed.

**`packages/core/tests/primitive/uuid.spec.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { Uuid } from "./uuid.js";

describe("Uuid", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates a value its own validator accepts", () => {
    expect(Uuid.isValid(Uuid.v7())).toBe(true);
  });

  it("stamps the version and variant nibbles", () => {
    const value = Uuid.v7();

    expect(value[14]).toBe("7");
    expect(value[19]).toMatch(/[89ab]/);
  });

  it("encodes the current millisecond in the leading 48 bits", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(at);

    const value = Uuid.v7();
    const leading = value.slice(0, 8) + value.slice(9, 13);

    expect(leading).toBe(at.getTime().toString(16).padStart(12, "0"));
  });

  it("differs between two calls in the same millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(Uuid.v7()).not.toBe(Uuid.v7());
  });

  it("rejects a malformed value", () => {
    expect(Uuid.isValid("not-a-uuid")).toBe(false);
    expect(Uuid.isValid("0195f0a0-0000-7000-0000-000000000000")).toBe(false);
  });
});
```

The last assertion is the one worth keeping, and for a reason easy to misread: it is the *variant* nibble that makes `0195f0a0-0000-7000-0000-…` invalid, not anything about the `7`. `isValid` constrains both positions — `[1-8]` for the version, `[89ab]` for the variant — so the nil and max UUIDs are rejected while a v4 minted somewhere else is still accepted. It is a shape guard, not a v7 assertion; see [`core/docs/reference/uuid.md`](../../packages/core/docs/reference/uuid.md).

**`packages/core/tests/primitive/result.spec.ts`** covers the factories and `mapOk`/`mapErr` the ordinary way, and then pins the narrowing:

```ts
describe("narrowing", () => {
  const widen = (r: Result<number, string>): Result<number, string> => r;

  it("narrows the fall-through after an early return", () => {
    const first = (r: Result<number, string>): number => {
      if (r.kind === "err") {
        return -1;
      }
      return r.value; // only compiles if the union narrowed
    };

    expect(first(widen(Results.ok(7)))).toBe(7);
    expect(first(widen(Results.err("nope")))).toBe(-1);
  });
});
```

> [!TIP]
> These are **compile-time assertions wearing a test's clothes**. `tests/` is inside the package's
> tsconfig `include`, so if `Result` ever regresses to a shape that does not narrow,
> `pnpm typecheck` fails on this file before a single test runs. The `widen` helper matters —
> without it `Results.ok(7)` infers as `Ok<number, string>`, which narrows trivially and would
> prove nothing.

Add a minimal Vitest config so `include` points at `tests/` and doesn't pick up `dist/`:

`ServerOnly` gets one too, and it is the least obvious of the four to test — the subject only fires
when a global exists that this package cannot name:

**`packages/core/tests/primitive/server-only.spec.ts`**

```ts
import { ServerOnlyError } from "@loadbearing/errors";
import { afterEach, describe, expect, it } from "vitest";
import { ServerOnly } from "../src/server-only.js";

const global_ = globalThis as { window?: unknown };

afterEach(() => {
  delete global_.window;
});

describe("ServerOnly", () => {
  it("is silent on a server, where there is no window", () => {
    expect(() => {
      ServerOnly.assert("@loadbearing/infrastructure");
    }).not.toThrow();
  });

  it("carries a code and the package name, and no prose at all", () => {
    global_.window = {};

    try {
      ServerOnly.assert("@loadbearing/auth");
      expect.unreachable("assert should have thrown");
    } catch (thrown) {
      const error = thrown as ServerOnlyError;

      expect(error.code).toBe("SERVER_ONLY");
      expect(error.message).toBe("SERVER_ONLY");
      expect(error.context).toEqual({ package: "@loadbearing/auth" });
    }
  });

  // `globalThis.window` reached as an optional property — never a bare `window`.
  it("treats an explicitly undefined window as absent", () => {
    global_.window = undefined;

    expect(() => {
      ServerOnly.assert("@loadbearing/composition");
    }).not.toThrow();
  });
});
```

**The third case is the one worth having.** `global_.window = undefined` is a *present* property
holding `undefined`, and the guard has to read that as "no browser". A check written as
`"window" in globalThis` passes this test's setup and then throws on a server that has any tooling
which defines the property — which is the failure this spec is here to prevent.

**`packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace siblings to their `src/`, the same condition
  // `apps/web/vite.config.ts` sets ([24](24-web-app.md)). Without it a spec runs
  // against a sibling's stale `dist/` and a green suite proves nothing about the
  // code you just edited.
  resolve: { conditions: ["development"] },
  test: { include: ["tests/**/*.spec.ts"] },
});
```

> [!IMPORTANT]
> **`resolve.conditions` is new here, and it is the first package that needs it.** `core` is the first
> package to import a workspace sibling, and the `exports` map in [06](06-package-anatomy.md) resolves
> `@loadbearing/errors` to `dist/index.js` under vitest's default conditions. Every package that
> imports another `@loadbearing/*` package in a spec wants this line; a leaf like `permissions` does
> not need it and does not have it.

---

## ✅ Gate

```bash
pnpm check                                  # format + organise imports, first
pnpm --filter @loadbearing/errors build     # core imports it; build the leaf first
pnpm --filter @loadbearing/core build
pnpm --filter @loadbearing/core test
pnpm --filter @loadbearing/core typecheck
pnpm lint                                   # biome check . && eslint .
```

> [!NOTE]
> **Lint is a root script, not a per-package one.** No package defines a `lint` script — Biome and
> ESLint both run once over the whole repo from the root, so `pnpm --filter @loadbearing/core lint`
> fails with `Command "lint" not found`. To narrow it while iterating, use
> `pnpm exec biome check packages/core`.
>
> Run `pnpm check` **before** `pnpm lint`, for the same reason [06](06-package-anatomy.md) does.

`packages/core/dist/` contains `index.js` and `index.d.ts`. **Do not proceed if it does not** — every later package copies this exact shape, and a problem here multiplies by fifteen.

**`errors` first, and not as a courtesy.** `core` now declares it, so `tsc --noEmit` here resolves `@loadbearing/errors` through the `types` condition to `packages/errors/dist/index.d.ts`. If that file does not exist the typecheck fails with `TS2307` and it looks like a broken import rather than a missing build. `pnpm build:packages` handles the ordering itself; a single filtered build does not.

Three of the four primitives come out of the build with the shape you expect; check that `index.d.ts` exports all of `Clock`, `SystemClock`, `FixedClock`, `Result`, `Ok`, `Err`, `ServerOnly` and `Uuid`. `Uuid`'s `private static webCrypto` appears in the declaration as an unresolved private — that is normal, and it is why the `WebCrypto` type is not exported.

---

[← Package Anatomy](06-package-anatomy.md) · [`@loadbearing/permissions` →](08-permissions-package.md)
