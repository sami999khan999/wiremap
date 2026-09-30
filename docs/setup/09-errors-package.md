# 09 · `@loadbearing/errors`

> The shared kernel, half three. One failure shape that every runtime throws, serialises, and reconstructs — carrying structure, never prose.

**Delivers:** `AppError`, a closed `ErrorCode` union, the wire envelope, and `ErrorNormalizer` — the boundary where anything thrown becomes something known.

**Prerequisite:** [08 · `@loadbearing/permissions`](08-permissions-package.md)

---

## Why this is its own package

Errors have to be understood in four places: the use-case that throws one, the transport that maps it to a status, the React component that decides what to render, and the worker that logs it and retries or does not.

Put the taxonomy in `application` and three of those four cannot reach it — `application` is server-only, banned by Biome from `packages/ui/**`, `packages/feature/**`, `packages/query/**` and `apps/web/src/**`. The consequence is not theoretical; it is what a client is forced into without this package:

```ts
const code = (error as { code?: string }).code;        // an untyped cast
if (error.message.includes("two-factor")) { … }        // control flow on prose
```

The first has no compile-time safety. The second breaks when someone rewords the copy, and it is already broken in every locale but English, because error text is translated. Both disappear once the vocabulary sits below `contracts` where every runtime can import it.

So this package has no database, no HTTP, no React, and no Node built-ins. Like `permissions`, it is data plus one algorithm, and it loads anywhere.

```
packages/errors/
├── vitest.config.ts
├── src/
│   ├── index.ts                  ← barrel
│   ├── app.error.ts              → AppError, TransportError, ErrorEnvelope, FieldViolation
│   ├── error-normalizer.ts       → ErrorNormalizer
│   ├── catalog/                  ← one fragment per slice, team-owned
│   │   ├── index.ts              ←   merges fragments (platform-owned)
│   │   └── core.errors.ts
│   ├── error/                    ← one class per code that carries context
│   │   ├── index.ts
│   │   ├── forbidden.error.ts    → ForbiddenError
│   │   ├── unauthorized.error.ts → UnauthorizedError
│   │   ├── two-factor-required.error.ts → TwoFactorRequiredError
│   │   ├── not-found.error.ts    → NotFoundError
│   │   ├── conflict.error.ts     → ConflictError
│   │   ├── validation.error.ts   → ValidationError
│   │   ├── internal.error.ts     → InternalError
│   │   └── server-only.error.ts  → ServerOnlyError   ← thrown by core, at module load
│   └── transport/
│       └── http.ts               → HTTP_STATUS   ← adapters only, never the domain
└── tests/
```

---

## The rule that shapes everything else

**An error carries no message.** `Error.message` is the code:

```
ForbiddenError: FORBIDDEN
    at ReactivateTaskUseCase.execute (…)
```

Every word a user reads lives in `@loadbearing/content` ([20](20-content-package.md)), keyed by code and translated. That is the same division `permissions` already draws — `permissions` owns `PermissionKey`, `content` owns the label, and `content` is forbidden from naming a permission at all.

This is the strongest available form of "no built-in error messages", because there is no message to leak, to forget to translate, or to match on. Three things follow, and all three are improvements rather than costs:

- **Logs get fields, not sentences.** `{ code: "FORBIDDEN", permission: "task.reactivate", goalId }` is what you actually want to filter on at 3am.
- **The server never sends prose.** It sends `{ code, context }` and the client renders in *its* locale. No server-side locale negotiation for API errors, and a desktop app running in a different language than the server is correct for free.
- **Error grouping in a reporter keys on the code**, not on an interpolated string that fragments into a thousand distinct "issues".

**There is no exception, including the one that used to be here.** `ServerOnly.assert` in `core` ([07](07-core-package.md#step-74--serveronly)) is the hardest case in the repository — it fires at module load, for a developer reading a console, and never crosses a wire — and it still throws a code. [Step 9.3](#step-93--serveronlyerror-and-the-exception-that-is-not-one) is where that gets wired, and it is the reason `core` declares this package.

> [!WARNING]
> The temptation is to add "just a short developer message" to the base class. Don't. The moment a message field exists, something renders it — a toast, a log line someone screenshots into a ticket, a `<pre>` in an error boundary — and now user-facing text lives outside `content` and outside translation. Structured `context` covers every legitimate use.

---

## Step 9.1 — The catalog

Same shape as the permission catalog: team-owned fragments, a platform-owned barrel, and a closed union derived from the data.

**`packages/errors/src/catalog/core.errors.ts`**

```ts
import type { ErrorMeta } from "./index.js";

export const coreErrors = {
  UNAUTHORIZED: { retryable: false, severity: "expected" },
  FORBIDDEN: { retryable: false, severity: "expected" },
  NOT_FOUND: { retryable: false, severity: "expected" },
  CONFLICT: { retryable: false, severity: "expected" },
  BAD_REQUEST: { retryable: false, severity: "expected" },
  TWO_FACTOR_REQUIRED: { retryable: false, severity: "expected" },
  RATE_LIMITED: { retryable: true, severity: "expected" },
  UNAVAILABLE: { retryable: true, severity: "unexpected" },
  INTERNAL: { retryable: false, severity: "unexpected" },
  // A server-only module reached a client bundle. A build defect, never a request.
  SERVER_ONLY: { retryable: false, severity: "unexpected" },
} as const satisfies Record<string, ErrorMeta>;
```

**`packages/errors/src/catalog/index.ts`**

```ts
import { coreErrors } from "./core.errors.js";

export type ErrorSeverity = "expected" | "unexpected";

export interface ErrorMeta {
  // Whether retrying the same call could produce a different answer.
  readonly retryable: boolean;
  // `expected` belongs in a log line; `unexpected` belongs in an alert.
  readonly severity: ErrorSeverity;
}

export const ERROR_CATALOG = {
  ...coreErrors,
  // ...billingErrors,
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;
```

**The metadata is transport-agnostic on purpose.** `retryable` is a fact about the code, not a policy — [21](21-query-package.md) reads it instead of hardcoding three code strings in a retry callback, and the worker reads the same field to decide whether to let BullMQ retry. Neither has to agree with the other by convention.

`severity` is what separates "a user tried something they cannot do" from "we are broken". Both are errors; only one should wake anyone.

**Its consumer is `Logger.failure()`** in `@loadbearing/observability`, which maps `expected → warn` and `unexpected → error`. That is the whole reason this field is metadata on the code rather than a judgement call at each `catch` — the decision is made once, next to the code, and every runtime that catches the error reaches the same answer.

---

## Step 9.2 — The envelope

**`packages/errors/src/error/app.error.ts`**

```ts
import { ERROR_CATALOG, type ErrorCode } from "../catalog/index.js";

export type ErrorContext = Readonly<Record<string, string | number | boolean>>;

export interface FieldViolation {
  readonly field: string;
  // A rule name, never a sentence. `content` maps it to a MessageKey.
  readonly rule: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly context: ErrorContext;
  readonly fields?: readonly FieldViolation[];
  readonly traceId?: string;
}

// `captureStackTrace` is a V8 extension, so `lib: ["ES2024"]` does not declare it
// and the bare call fails with `TS2339` — the same situation as `crypto` in
// [07](07-core-package.md). Name the one method and reach it off the value.
type StackTraceCapture = {
  captureStackTrace?: (target: object, constructorOpt?: unknown) => void;
};

export abstract class AppError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    public readonly context: ErrorContext = {},
    public readonly fields?: readonly FieldViolation[],
  ) {
    // The code *is* the message. Nothing else is ever assigned here.
    super(code);
    this.name = new.target.name;
    (Error as StackTraceCapture).captureStackTrace?.(this, new.target);
  }

  public get retryable(): boolean {
    return ERROR_CATALOG[this.code].retryable;
  }

  public toJSON(): ErrorEnvelope {
    return {
      code: this.code,
      context: this.context,
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }

  public static isKnownCode(value: string): value is ErrorCode {
    return Object.hasOwn(ERROR_CATALOG, value);
  }
}
```

**The code is a constructor parameter, not an abstract field.** The obvious draft declares `code` abstract and overrides `message` with a getter — and it does not typecheck, because `Error.message` is a mutable property and a get-only accessor is not assignable to one. Passing the code to `super(code)` is simpler, makes `message` the code with no override at all, and means a subclass cannot forget to supply one.

`toJSON()` / an envelope that round-trips is deliberately the same idiom as `CapabilitySet` ([08](08-permissions-package.md)): the server throws, the wire carries JSON, and the client reconstructs a class whose `.code` it can switch on. One implementation, four runtimes.

`from()` returns `AppError | null` — an unrecognised code is rejected rather than trusted, and what comes back is a `TransportError` carrying the code and context but not the original class. Callers only ever read `.code`, which is the point.

**`isKnownCode` uses `Object.hasOwn`, not `in`** — the identical reason `PermissionRegistry.isKnown` does. `"constructor" in ERROR_CATALOG` is `true`, and an envelope arriving from the wire is untrusted input.

**A concrete error carries context, not text:**

```ts
export class ForbiddenError extends AppError {
  public constructor(permission: string, goalId?: string) {
    super("FORBIDDEN", goalId ? { permission, goalId } : { permission });
  }
}
```

`{ permission, goalId }` is what a log query wants and what `content` interpolates into `"You do not have permission to do that."` — or, for a screen that shows more detail, into a template that names the permission.

---

## Step 9.3 — `ServerOnlyError`, and the exception that is not one

`ServerOnly.assert` in `core` ([07](07-core-package.md#step-74--serveronly)) is the one throw in this repository with a real argument for carrying prose. It loses, and this is the class that replaces it.

**`packages/errors/src/error/server-only.error.ts`**

```ts
import { AppError } from "./app.error.js";

// A server-only package was loaded in a client bundle.
//
// Thrown by `ServerOnly.assert` in `@loadbearing/core` at module load — the one
// error in this repository that fires before there is a request, a session, or a
// locale. It still carries no prose: the sentence a developer needs is
// `error.serverOnly` in `@loadbearing/content`, and `{package}` in that template
// is interpolated from this context.
//
// The context key is `package`, not `packageName`, because the key *is* the
// placeholder name in the copy.
export class ServerOnlyError extends AppError {
  public constructor(packageName: string) {
    super("SERVER_ONLY", { package: packageName });
  }
}
```

### Why the hardest case still loses

The sentence that used to be inline was worth keeping:

> `@loadbearing/infrastructure` was imported into a client bundle. This is a leak, not a bundle-size problem — it means database or credential code is reachable from the browser.

It is still worth keeping, and it is still exactly that. It lives in `content` as `error.serverOnly` ([20](20-content-package.md#step-201--messages)), `{package}` is interpolated from the context above, and `ERROR_COPY.SERVER_ONLY` points at it — so a console reader, an error boundary and a dev overlay all render the same words, and a developer who reads Bengali can have them in Bengali. Nothing was lost; the string moved to the only place in the repository that owns strings.

What the throw site keeps is what a throw site is good at:

```
ServerOnlyError: SERVER_ONLY
    at ServerOnly.assert (…)
    at packages/infrastructure/src/index.ts:2:12
```

The class names the fault, the frame below names the package. `{ package: "@loadbearing/infrastructure" }` is the field a log query filters on, which a sentence is not.

**The reason to refuse the exception is the base class, not this call site.** Grant a `message` field for the honest case and it exists for every other one — and a field that exists gets rendered, by a toast, by a `<pre>` in an error boundary, by a log line someone screenshots into a ticket. "No prose in errors" is enforceable only while it has no exceptions, and the cost of holding it here turned out to be zero.

> [!NOTE]
> **`SERVER_ONLY` is `severity: "unexpected"` and `retryable: false`.** It is a build defect, so it
> belongs in an alert rather than a log line, and a second attempt at the same bundle produces the
> same answer. `HTTP_STATUS` gives it `500` because the record is total over `ErrorCode` — no request
> can ever reach it, since the module that would serve the request is the one that failed to load.

### This is why `core` depends on `errors`

```bash
pnpm add --filter @loadbearing/core @loadbearing/errors@workspace:*
```

One edge, and it is acyclic: `errors` has no dependencies at all, so nothing here can reach back into `core`. `core` also stays isomorphic, which is the property that actually mattered about it being a leaf — `errors` loads in a browser, a worker, and a Tauri webview for the same reasons `core` does.

The two packages are documented in this order because `core`'s primitives are what a reader needs first, not because a layer sits between them. **`pnpm build:packages` reads the graph, not the doc numbers**, and will build `errors` before `core`; if your build log shows the reverse, the dependency is missing from `packages/core/package.json`.

> [!WARNING]
> An earlier revision of [07](07-core-package.md) declared this the one permitted exception and said
> not to "fix" it by inverting the two packages. Inverting them was the fix. If you are reading a
> checked-out copy that still argues for the exception, this step is the newer decision.

---

## Step 9.4 — `ErrorNormalizer`

The "handler" half. Everything thrown anywhere crosses this before it is transported, logged, or rendered.

**`packages/errors/src/normalizer/error-normalizer.ts`**

```ts
import { AppError, InternalError, type SchemaIssue, ValidationError } from "../error/index.js";

export class ErrorNormalizer {
  private constructor() {}

  public static normalize(thrown: unknown): AppError {
    if (ErrorNormalizer.isAppError(thrown)) return thrown;
    if (ErrorNormalizer.isZodLike(thrown)) return ValidationError.fromIssues(thrown.issues);
    return new InternalError();
  }

  // Structural, not `instanceof`. Two copies of this package in one process —
  // a pnpm hoisting quirk, a bundled dependency, an SSR/client boundary — give
  // two distinct class identities, and `instanceof` silently answers `false`.
  // A known `code` plus a callable `toJSON` is the durable check.
  private static isAppError(value: unknown): value is AppError {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; toJSON?: unknown };
    return (
      typeof candidate.code === "string" &&
      AppError.isKnownCode(candidate.code) &&
      typeof candidate.toJSON === "function"
    );
  }
}
```

| Thrown | Becomes |
| --- | --- |
| an `AppError` | itself |
| a `ZodError` | `ValidationError`, carrying **rule names** |
| an `Error`, a string, `undefined`, a rejected non-error | `InternalError` |

**The original is retained for the logger and never reaches the envelope.** `InternalError` holds it on a non-enumerable `cause` so a log adapter can record it and `toJSON()` cannot accidentally serialise it — `Object.defineProperty` with `enumerable: false`, and `public override readonly cause`, because `Error.cause` exists in the ES2022 lib and `noImplicitOverride` catches a missing modifier. This generalises the rule [24](24-web-app.md) already states: a Postgres error string in a client response tells an attacker your table names.

**Zod's default messages are built-in messages, so they are discarded.** An issue becomes `{ field, rule, params }`:

```ts
{ field: "reason", rule: "tooShort", params: { min: 10 } }
```

`content` renders `error.field.tooShort` — `"{field} must be at least {min} characters."` — which already exists in its catalog. So `reason: z.string().min(10)` still declares the rule exactly once, as [10](10-contracts-package.md) argues; only the sentence moved somewhere it can be translated.

> [!IMPORTANT]
> This is also why **contracts must not carry custom Zod messages**. A `{ message: "Reason is too short" }` in a schema is user-facing text living outside `content`, which is the thing this split exists to prevent. The rule name is the contract; the sentence is copy.

---

## Step 9.5 — `HTTP_STATUS` is quarantined

**`packages/errors/src/transport/http.ts`**

```ts
export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  TWO_FACTOR_REQUIRED: 401,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
  // Unreachable over HTTP — the guard fires at module load. Total record, so it needs one.
  SERVER_ONLY: 500,
};
```

`Record<ErrorCode, number>` makes this total: add a code and this fails to compile until it has a status.

**`application` may never import it.** `ForbiddenError` is a domain concept and `403` is a transport concept, and the discipline that keeps the transport swappable is that the domain layer has never heard of the number ([12](12-application-package.md)). Since both live in this package now, a lint rule enforces what a package boundary used to:

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

Same mechanism, same file, as the ban that stops `content` importing `PermissionKey` ([20](20-content-package.md)).

---

## Step 9.6 — Throw or return?

Unchanged from [07](07-core-package.md), and worth restating rather than reopening:

- **Throw an `AppError`** when the caller has no meaningful recovery and the boundary should map it — a missing permission, a row that is not there, a version conflict.
- **Return a `Result`** when the caller genuinely branches on both outcomes and the failure is an expected value rather than a fault.

`Result` stays in `core`. If `Result<T, AppError>` starts appearing everywhere, the codebase is drifting toward exception-free purism and away from readable use-cases.

---

## Step 9.7 — Tests

`vitest.config.ts` points `include` at `tests/`, and `tsconfig.json` lists `tests/**` alongside `src/**` so `tsc --noEmit` covers the specs ([07](07-core-package.md)).

The five that matter:

1. **`normalize()` is total.** An `AppError`, a `ZodError`, an `Error`, a bare string, `undefined`, and `null` all produce a valid envelope — the last four as `INTERNAL`.
2. **No original text escapes.** Normalise an `Error("connection to db-prod-01 refused")` and assert that string appears nowhere in `JSON.stringify(envelope)`. This is the requirement, so test it directly.
3. **Round-trip.** `AppError.from(err.toJSON()).code === err.code`, and an envelope with an unknown code is rejected rather than trusted.
4. **`ValidationError` carries rules.** Given a real `ZodError` from a `contracts` schema, the envelope holds `{ field, rule, params }` and **no Zod default message**.
5. **Coverage.** Every `ErrorCode` has an entry in `HTTP_STATUS`; the compiler enforces it, and a test asserts the catalog and the status map have not diverged in count.
6. **`ServerOnlyError` names its context key `package`.** That key is the placeholder in `error.serverOnly`, so renaming it here silently turns the rendered sentence back into a literal `{package}` — nothing else would fail. `tests/server-only.error.spec.ts` asserts the key list directly, and `content` asserts the rendered sentence from the other side ([20](20-content-package.md)). The seam is tested from both ends because neither package can see the other's half of it.

---

## ✅ Gate

- A misspelled code is a **compile error**: `new ForbiddenError(…)` narrows `code` to a literal, and `HTTP_STATUS["FROBIDDEN"]` fails to compile.
- `pnpm --filter @loadbearing/errors typecheck` is clean and `test` passes.
- `pnpm exec biome check packages/errors` and `pnpm exec eslint packages/errors/src` are clean.
- `pnpm --filter @loadbearing/errors build` emits `dist/index.d.ts`.
- The package has **no `dependencies`** — only `devDependencies`. Like `permissions`, it is a leaf. `core` now depends on *it*, which is the direction that keeps this true.
- `rg "message" packages/errors/src` finds the `message` getter and nothing that assigns prose.
- `new ServerOnlyError("@loadbearing/infrastructure").message === "SERVER_ONLY"`, and `JSON.stringify(…toJSON())` contains none of the words *leak*, *bundle* or *browser*. The sentence is `content`'s job from here on.
- `pnpm build:packages` builds `errors` **before** `core`. That is the proof the new edge is declared; if the order is reversed, `packages/core/package.json` is missing `@loadbearing/errors`.

Do not proceed until this passes.

---

[← `@loadbearing/permissions`](08-permissions-package.md) · [`@loadbearing/observability` →](09b-observability-package.md)
