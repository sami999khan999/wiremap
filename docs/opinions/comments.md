---
title: Comments
description: Line comments only, two lines maximum, and the argument for a design lives in docs/reference instead.
---

# Comments

## Every comment is `//`. There is no second form

No `/* */`, no `/** */`, and no JSX `{/* */}` — in any `src/` or `tests/` under `packages/*` or
`apps/*`, and not for a note above a class, a section separator, or commented-out code.

```ts
// packages/errors/src/error/app.error.ts
// The one failure shape, thrown on the server and rebuilt on the client. It carries
// no message — every word lives in `content`, keyed by code.
export abstract class AppError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    public readonly context: ErrorContext = {},
    public readonly fields?: readonly FieldViolation[],
  ) {
    // The code *is* the message. Nothing else is ever assigned here.
    super(code);
    this.name = new.target.name;
  }
}
```

**One form means no decision.** A repository with both forms spends review cycles on which one this
line deserves, and the answer is never interesting. Picking one and applying it everywhere costs
nothing and settles the question permanently.

**What this gives up, stated honestly.** A block comment above a declaration is JSDoc: it reaches
editor hover, the generated `.d.ts`, and any API-docs tool pointed at the package. A `//` comment
reaches none of them. That is a real cost, accepted deliberately — because the place a consumer
should learn what `AppError` is for is the package's `docs/reference/app-error.md`, which can hold
a worked example and gets reviewed like prose. A hover tooltip cannot, and quietly rots.

## Two lines is the ceiling

A comment's job is to stop the *next* reader misreading the line under it. Anything longer is
documentation that has been pasted into the wrong file.

```ts
// `Object.hasOwn`, not `in` — `in` walks the prototype chain and admits `toString`.
public static isKnownCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CATALOG, value);
}
```

The long-form reasoning — why `CapabilitySet.intersect()` unions denies and intersects grants, why
`CLIENT_CATALOG` needs string-literal `import()` specifiers, why `InternalError.cause` is
non-enumerable — lives in the package's `docs/reference/`, where it can have headings, worked
examples, and a description of the failure it prevents.

**Say the constraint in the code. Let the reference page carry the argument.**

Where the argument matters and a reader will want it, point at it:

```ts
// Narrow to the intersection with another set. Denies union, grants intersect, goal
// keys union — see docs/reference/capability-set.md for why each is load-bearing.
public intersect(other: CapabilitySet): CapabilitySet {
```

## The JSX form is `{ // }`

A comment between two JSX children has to sit in an expression position, and `{/* … */}` is the
form everybody reaches for. It is banned like every other block:

```tsx
{
  // `role="alert"` so the message is announced when it appears, not only when the
  // input is next focused.
}
<p className="ui-field__error" role="alert">{error}</p>
```

An empty expression container renders nothing, and the two-line ceiling applies inside it. Where the
comment can be hoisted out of the child list entirely — above the `return`, or onto the line that
builds the value — hoist it instead.

## Commented-out code is not a comment

A placeholder like this:

```ts
export const ERROR_CATALOG = {
  ...coreErrors,
  // ...billingErrors,
} as const;
```

becomes a sentence instead:

```ts
// Merged from team-owned fragments. Add them here — `...billingErrors`.
export const ERROR_CATALOG = {
  ...coreErrors,
} as const;
```

Git remembers the deleted version. A reader cannot tell a deliberate placeholder from a regression
someone commented out at 2am.

## Cutting an existing comment down

Six rules, applied uniformly. They are what the phase-1 sweep across every package used, and what a
reviewer should apply to a comment that has grown past the ceiling.

1. **Keep a comment only if the next reader would otherwise misread the line beneath it.** That is
   the whole test. A comment explaining *why the decision was made* is an argument; a comment
   explaining *what breaks if you change this line* is a constraint.
2. **Cut outright:** changelog and history ("`pending` stood here and was removed", "has been in the
   catalog since 09"), war stories ("ran green for months"), cross-references to setup-doc numbers,
   restatements of a rule in `docs/ai/rules/`, pre-emptive scope defences ("a campaign or a
   suppression list is a different product"), cross-package analogies, and any paragraph that
   appears in more than one file.
3. **An argument worth keeping moves to `packages/<name>/docs/reference/<subject>.md`**, registered
   in `reference/meta.json` and named from the parent `index.md`. Leave a pointer in the code:
   `// see docs/reference/x.md`.
4. **An `import.ts` header is one line plus its `// ── @scope/pkg ──` separators.**
5. **A JSX block becomes `{ // }`**, or is deleted — see above.
6. **CSS under `packages/ui/src/style/**` keeps `/* */`**, because there is no `//` form in CSS. The
   same two-line ceiling applies.

> [!NOTE]
> An argument that has no reference page to move to is a reference page that needs writing. That is
> the expensive half of this rule and the reason it is worth doing once: `docs/reference/` is
> reviewed like prose, and a comment is not.

## Separators are `//` too

`import.ts` groups its specifiers under one separator per source:

```ts
// packages/core/src/import.ts
// Everything this package takes from outside itself, in one place. No relative
// re-exports live here — that is what keeps it cycle-free.

// ── @loadbearing/errors ──────────────────────────────────────────────────────
export { ServerOnlyError } from "@loadbearing/errors";
```

## The one place `/* */` survives

Documentation samples elide code with an inline block comment, because a `//` cannot close and let
the line continue:

```ts
const BY_MODULE: ReadonlyMap<string, readonly PermissionKey[]> = /* grouped once */;
```

That is a prose device inside a Markdown fence, not source. No file under `src/` or `tests/`
contains one.

## What this is not

**Not a rule against comments.** A comment that says why the obvious approach is wrong is worth
more than the line it sits above. `server-only.ts` reads `globalThis.window` instead of `window`,
and without the comment the next person "simplifies" it into a compile error:

```ts
// `globalThis.window`, not bare `window` — no DOM lib, so the identifier is TS2304.
if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
```

**Enforced, but not by a linter.** Neither Biome nor ESLint ships a rule that expresses either
half, so both are assertions in `check-architecture.mjs`
([26](../setup/26-hygiene-and-ci.md)), over `{src,tests}` under **`packages/*` and `apps/*`**:

| | |
|---|---|
| **§5** | any line whose trimmed form opens with `/*` or `{/*` fails the build |
| **§14** | three or more consecutive `//` lines fail the build |

§14 exempts what carries no prose: a `// ──` separator, and a `// biome-ignore`,
`// eslint-disable` or `// @ts-` pragma. Each of those **ends** a run rather than extending it, so
two comment lines either side of a separator are two comments rather than one block of five.
Generated files (`*.gen.ts`) are skipped — `route-tree.gen.ts` asks in its own header to be
excluded from every checker pointed at it.

Anchoring to the start of a trimmed line is what makes the grep safe. Biome always formats a block
comment onto its own line, so a glob like `"**/dist/**"` inside a string cannot be mistaken for one
— and unlike a lint rule, no inline comment can silence either assertion.

**`pnpm check:comments` reports; it never fails.** It prints per-package comment density, block
count and the twenty-five files carrying the most comment lines, which is what makes "this package
is drifting" visible before any single file trips §14.
