---
title: uuid
description: UUIDv7 generation and validation — why time-ordered keys beat random ones, what they leak, and why crypto is not a global this package can see.
---

# `Uuid`

```ts
Uuid.v7();               // "0194a5c3-8f21-7b4e-9a02-3c8d1f6e0a7b"
Uuid.isValid(someInput); // boolean
```

A static-only class with a `private constructor()`, the standard namespacing shape here. Biome's
`noStaticOnlyClass` is [off on purpose](../../../../tooling/biome-config/docs/index.md) for exactly
this pattern.

---

## Why v7 rather than v4

Every primary key in the schema is a UUID, so this choice compounds across every table.

A **v4** key is entirely random, so each insert lands at a random point in the primary-key index.
The B-tree fragments, and the working set the database has to keep warm is the *whole* index
rather than its tail.

A **v7** key embeds a 48-bit millisecond timestamp in the high bits. Inserts are append-mostly,
pages fill in order, and rows created together sit together on disk — which also makes
`created_at`-ordered range scans cheap without a second index.

On a table with a few hundred thousand rows the difference is measurable. On a few million it is
the difference between a fast insert path and a slow one.

> [!WARNING]
> **v7 IDs leak their creation time**, to the millisecond, to anyone holding one. That is fine for
> internal identifiers. Avoid it for anything a customer sees in a URL where creation order or
> volume is itself sensitive — in that case, carry a separate opaque public identifier rather than
> switching the primary key back to v4.

---

## The layout

```
0194a5c3-8f21-7b4e-9a02-3c8d1f6e0a7b
└─────┬─────┘ └┬┘  └┬┘ └──────┬─────┘
      │        │    │         └─ 74 bits random (the rest)
      │        │    └─────────── variant: top 2 bits forced to 0b10
      │        └──────────────── version: high nibble forced to 0x7
      └───────────────────────── 48-bit millisecond timestamp, big-endian
```

| Bytes | Hex positions | Contents |
| --- | --- | --- |
| 0–5 | groups 1 and 2 | `Date.now()`, big-endian |
| 6 | group 3, first nibble | version `7`, then 12 random bits |
| 8 | group 4, first nibble | variant `0b10xx`, then random |
| rest | — | random |

```ts
const ts = BigInt(Date.now());
const bytes = Uuid.webCrypto().getRandomValues(new Uint8Array(16));
for (let i = 0; i < 6; i++) {
  bytes[i] = Number((ts >> BigInt(40 - i * 8)) & 0xffn);
}
bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
```

Sixteen random bytes first, then the first six are overwritten with the big-endian timestamp and
two nibbles are forced. `Date.now()` here is the **only** sanctioned read of the system clock in
`packages/` — see [clock](clock.md) — and it is building an identifier, not deciding anything.

The `?? 0` on the two reads can never fire; a `Uint8Array(16)` always has indices 6 and 8. It is
there because `noUncheckedIndexedAccess` types the read as possibly-`undefined`, and it discharges
that without a non-null assertion, which Biome's `noNonNullAssertion` flags.

---

## Why `crypto` is not a global here

> [!CAUTION]
> Written the obvious way — a bare `crypto.getRandomValues(...)` — this file compiles **by
> accident**, and the accident is invisible.

TypeScript declares the `crypto` global in `lib.dom.d.ts` and `lib.webworker.d.ts` only.
[`library.json`](../../../../tooling/tsconfig/docs/reference/presets.md) sets `lib: ["ES2024"]` and loads
neither, which is exactly what makes this package honestly isomorphic.

So why did it typecheck? `tests/clock.spec.ts` imports `vitest`; vitest's types pull in vite's; and
vite carries `/// <reference types="node" />`, which drops the whole `@types/node` global surface —
`crypto` included — into `core`'s program. Delete the spec files and the package stops compiling
with `TS2304: Cannot find name 'crypto'`. Verified by compiling `src/uuid.ts` alone against a bare
ES2024 lib.

Moving the specs from `src/` to `tests/` did not change this: `tsconfig.json` includes `tests/**`,
so the spec files are still in the same program. Removing that glob reproduces the `TS2304` —
also verified.

The fix names the one method actually used and reaches it off `globalThis`:

```ts
type WebCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

private static webCrypto(): WebCrypto {
  return (globalThis as unknown as { crypto: WebCrypto }).crypto;
}
```

Three alternatives were considered and rejected:

| Alternative | Why not |
| --- | --- |
| add `@types/node` to `core` | `core` is the one package that must typecheck as isomorphic; this would also make `process` and `Buffer` resolve here |
| add `"DOM"` to `lib` | brings back `window`, which [`ServerOnly`](server-only.md) depends on *not* being declared |
| an ambient `declare const crypto` in `src/*.d.ts` | collides with `@types/node`'s own declaration wherever both land in one program |

`WebCrypto` is not exported, so it never reaches `dist/index.d.ts`; the declaration emits
`private static webCrypto;` and consumers see nothing.

At **runtime** the doc's original claim holds unchanged: `crypto.getRandomValues` is Web Crypto,
global in Node 19+, in every browser, and in a Tauri webview. No import, no polyfill. This is a
type-level problem only.

---

## `isValid` checks the version *and* the variant, and asserts neither is v7

```ts
/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
```

Two constrained nibbles, and they mean different things. `[1-8]` is the version — every version RFC
9562 defines — and `[89ab]` is the variant. So:

- `…-7000-0000-000000000000` is **rejected** — the variant nibble is `0`.
- The nil UUID and the max UUID are **rejected** — neither carries a defined version.
- A well-formed **v4** is **accepted**, deliberately.

**The version group used to be `[0-9a-f]`**, which is to say the version was not checked at all: a
string with a correct variant and a version nibble of `0` or `f` passed, and neither is an
identifier anything mints. That was a defect, and fixing it does not make this a v7 assertion.

`isValid` is a cheap shape guard for untrusted input at the edge. An identifier minted elsewhere —
by a client, an import, an older row — is still an identifier, and rejecting it here would move a
schema decision into a regex. If you need "is this specifically a v7", check `value[14] === "7"` at
the call site, where the reason for wanting that is visible.

---

## Tests

`tests/uuid.spec.ts` pins the timestamp with `vi.setSystemTime` and asserts the leading 48 bits
round-trip, which is the claim the whole B-tree argument rests on:

```ts
const at = new Date("2026-01-01T00:00:00.000Z");
vi.useFakeTimers();
vi.setSystemTime(at);

const value = Uuid.v7();
const leading = value.slice(0, 8) + value.slice(9, 13);

expect(leading).toBe(at.getTime().toString(16).padStart(12, "0"));
```

---

## See also

- [`@loadbearing/core`](../index.md)
- [Clock](clock.md) · [Result](result.md) · [ServerOnly](server-only.md)
