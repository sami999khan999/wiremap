---
title: boundary
description: The server-only import boundary — the three overrides blocks that keep database code out of the browser, and the two ways this config can fail silently.
---

# The server-only boundary

The rule that keeps database code out of the client bundle. It lives entirely in `overrides`,
and it is the first of three independent defences.

> [!CAUTION]
> A Drizzle import reaching the client is not a bundle-size regression. It puts the shape of
> your connection string and your full table schema in a public asset anyone can read in
> devtools. That is why there are three defences rather than one.

---

## Block 1 — the ban

```json
{
  "includes": ["packages/ui/**", "packages/feature/**", "packages/query/**", "apps/web/src/**"],
  "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": {
    "paths": {
      "@loadbearing/infrastructure": "Server-only. Cross the boundary via @loadbearing/contracts.",
      "@loadbearing/auth":           "…",
      "@loadbearing/composition":    "…",
      "@loadbearing/application":    "…",
      "drizzle-orm": "Server-only dependency. It must never appear in a client bundle.",
      "pg": "…", "ioredis": "…", "bullmq": "…", "better-auth": "…"
    }
  } } } }
}
```

**Five workspace packages and five third-party ones.** The first four workspace entries hold
connection pools, credentials, and vendor SDKs. `application` is on the list for a different
reason: it is harmless to bundle, but a component importing a use-case is about to call business
logic directly instead of going through the transport, so banning it keeps every call one-way.

**The sanctioned crossing is `@loadbearing/contracts`**, which is isomorphic by construction —
Zod schemas, entities with behaviour but no I/O, and the oRPC contract. Both sides import it
freely.

> [!NOTE]
> **Biome's `noRestrictedImports` takes exact module paths, not globs.** That is fine here
> because every banned import is an exact package name — but it means a subpath family like
> `drizzle-orm/*` cannot be expressed. `drizzle-orm/pg-core` is the import that actually appears
> in practice, so if you need subpath coverage the ban has to move to ESLint, where
> `no-restricted-imports` supports `patterns` with `group`.

---

## Block 2 — the escape hatch

```json
{
  "includes": ["apps/web/src/server/**", "apps/web/src/route/api/**", "**/*.server.ts"],
  "linter": { "rules": { "style": { "noRestrictedImports": "off" } } }
}
```

**Exactly two directories and one filename suffix**, and the narrowness is the whole design.
Whether a file may touch the database is answered by its path.

| Location | Holds |
| --- | --- |
| `apps/web/src/server/**` | the entire transport layer — container, oRPC base and routers, error interceptor, in-process SSR client |
| `apps/web/src/route/api/**` | the two mounted fetch handlers, for oRPC and Better Auth |
| `**/*.server.ts` | the per-file opt-out, for a server-only helper that belongs beside its route |

> [!IMPORTANT]
> **Later overrides win, so the escape hatch must come after the ban.** Reverse the order and
> it does nothing — with no error either way, because a no-op override is not a
> misconfiguration Biome can detect.

`src/server/` being one directory rather than logic scattered through route files is also the
migration seam: if NestJS ever owns the API, that directory moves to `apps/api` and nothing
above or below it changes.

---

## Block 3 — the `env.ts` exemption

```json
{
  "includes": ["apps/*/src/env.ts"],
  "linter": { "rules": { "style": { "noProcessEnv": "off" } } }
}
```

Two files in the entire repository may read `process.env` — `apps/web/src/env.ts` and
`apps/worker/src/env.ts`. One glob covers both. That is what makes "config arrives through
`ContainerConfig`" a checkable claim rather than a convention, and it is what lets the whole
system be constructed in a test with a fake database and a frozen clock.

---

## Two ways this config fails silently

Both were reproduced against Biome 2.5.7. Both produce a **green lint run** with the boundary
gone, which is the worst available failure mode for a security control.

### 1 — overrides replace rule options; they do not merge

If two `overrides` blocks both match a file and both set `noRestrictedImports`, only the last
one's `paths` apply. The earlier map is **discarded**, not concatenated.

> [!CAUTION]
> Verified by adding a second `packages/feature/**` override listing only that package's own
> two bans. `import { Database } from "@loadbearing/infrastructure"` inside `feature` then **passed**.
>
> Any override you add for a package already covered by Block 1 must restate every path it
> still needs.

This kit sidesteps the problem structurally: there is exactly **one** `noRestrictedImports`
override, and `feature`'s two extra bans live in ESLint instead — which they have to, for the
next reason.

### 2 — `import type` is flagged like a value import

Biome's `noRestrictedImports` has no type-import exemption. A type-only import emits nothing
and creates no runtime dependency, but the rule cannot tell the difference.

That is why `feature`'s `@loadbearing/api-client` ban cannot live here: `SignInForm` needs
`import type { AuthClient }`, and a Biome-side ban would error on correct code. It sits in the
ESLint config with `@typescript-eslint/no-restricted-imports` and `allowTypeImports: true`.

Leave the **server-only** paths in Block 1 strict, though. Nothing in a React package should
name a type from `db`, `auth`, `infrastructure`, or `composition` even in a position that
erases — if it does, the boundary is being reached across rather than crossed through
`contracts`.

---

## Verifying the boundary

Do not trust the config; test it. Each of these takes seconds:

```bash
# must ERROR
echo 'import { Database } from "@loadbearing/infrastructure";' > packages/feature/src/probe.ts
pnpm exec biome lint packages/feature/src/probe.ts

# must PASS — escape hatch
echo 'import { Database } from "@loadbearing/infrastructure";' > apps/web/src/server/probe.ts
pnpm exec biome lint apps/web/src/server/probe.ts

# must ERROR, then PASS
echo 'const x = process.env.FOO;' > packages/ui/src/probe.ts
echo 'const x = process.env.FOO;' > apps/web/src/env.ts
pnpm exec biome lint packages/ui/src/probe.ts apps/web/src/env.ts
```

Run them after any change to `overrides`, and delete the probes afterwards.

---

## The other two defences

| # | Defence | Catches | When |
| --- | --- | --- | --- |
| 1 | this import boundary | a direct import | as you type |
| 2 | `ServerOnly.assert()` at each server-only barrel | module evaluation in a browser | at runtime |
| 3 | CI grep over built client assets | a transitive re-export no import rule sees | in CI |

Each catches something the others cannot. Biome can be silenced with a suppression comment, the
runtime assertion only fires on a path that actually executes, and the bundle grep is the only
one that inspects what really shipped.

> [!WARNING]
> The CI grep is meaningful only if the pipeline builds `apps/web` first. A grep over a
> directory that does not exist passes silently — make the script fail when it finds zero asset
> files. See [25](../../../../docs/setup/26-hygiene-and-ci.md).

---

## See also

- [Overview](../index.md) — the formatter, assist, and lint configuration
- [`@loadbearing/eslint-config` rules](../../../eslint-config/docs/reference/rules.md) — the bans that need nuance
