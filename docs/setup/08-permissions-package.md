# 08 · `@loadbearing/permissions`

> The shared kernel, half one. The permission registry, the module registry, and the capability resolver every runtime consults.

**Delivers:** `PermissionRegistry`, `ModuleRegistry`, `CapabilitySet` — deny-by-default resolution running identically on server, client, worker, and desktop.

**Prerequisite:** [07 · `@loadbearing/core`](07-core-package.md)

---

## Why this is one artifact

The strongest claim the architecture makes is that there is no hardcoded role check anywhere and no second security model to keep in sync. That only survives contact with reality if the permission vocabulary, the resolution algorithm, and the scope rules are **one artifact** shared by every runtime — the oRPC handler, React route guards, the `<Can>` component, the worker, and the Tauri desktop app.

So this package has no database, no HTTP, no React, and no Node built-ins. It is pure data plus one resolution algorithm, and it loads anywhere.

```
packages/permissions/
├── vitest.config.ts
├── tests/
│   ├── permission-registry.spec.ts
│   ├── module-registry.spec.ts
│   └── capability-set.spec.ts
└── src/
    ├── index.ts
    ├── permission-registry.ts   → PermissionRegistry, PermissionKey, PermissionMeta, PermissionScope
    ├── module-registry.ts       → ModuleRegistry, ModuleKey, ModuleGate
    ├── capability-set.ts        → CapabilitySet, CapabilitySetDto, ScopedSetDto
    ├── catalog/                 ← one fragment per slice, team-owned
    │   ├── index.ts             ←   merges fragments (platform-owned)
    │   └── rbac.permissions.ts
    ├── gate/                    ← same pattern for nav gates
    │   ├── index.ts
    │   └── rbac.gate.ts
    └── route/                   ← same pattern for destinations
        ├── index.ts             ←   ROUTES, AppRoute, RoutePath
        ├── shell.routes.ts      ←   platform-owned: home, sign-in, forbidden
        └── rbac.routes.ts
```

---

## Step 8.1 — Fragment the catalog from day one

One `CATALOG` object works until three teams edit it in the same sprint and every pull request conflicts. Split it by module and merge in a barrel. The literal-union type survives the spread, so typo-safety is unaffected.

**`packages/permissions/src/catalog/rbac.permissions.ts`** — the only fragment the starter kit ships:

```ts
import type { PermissionMeta } from "../permission-registry.js";

export const rbacPermissions = {
  "rbac.role.read": { scope: "org", module: "rbac", label: "View roles" },
  "rbac.role.manage": { scope: "org", module: "rbac", label: "Create and edit roles" },
  "rbac.permission.grant": { scope: "org", module: "rbac", label: "Grant permissions" },
  "rbac.permission.revoke": { scope: "org", module: "rbac", label: "Revoke permissions" },
  "rbac.effective.inspect": {
    scope: "org",
    module: "rbac",
    label: "Inspect effective permissions",
  },
  "member.read": { scope: "org", module: "rbac", label: "View members" },
  "member.invite": { scope: "org", module: "rbac", label: "Invite members" },
  "member.deactivate": { scope: "org", module: "rbac", label: "Deactivate members" },
  "apikey.read": { scope: "org", module: "rbac", label: "View API keys" },
  "apikey.manage": { scope: "org", module: "rbac", label: "Create and revoke API keys" },
} as const satisfies Record<string, PermissionMeta>;
```

**`packages/permissions/src/catalog/index.ts`** — platform-owned, changes only when a module is added:

```ts
import { rbacPermissions } from "./rbac.permissions.js";

export const CATALOG = {
  ...rbacPermissions,
  // ...taskPermissions,
  // ...financePermissions,
} as const;
```

Each team owns one file. Two teams adding permissions in the same week touch different files and never conflict.

### The key format

```
<module>.<subject>.<action>[.<qualifier>]
```

Lowercase, dot-separated, no plurals. `task.reactivate`, `finance.invoice.approve`, `task.update.self`. The `.self` qualifier is the convention for "the same action, but only on rows you own" — the entity decides what "own" means, so `task.update` and `task.update.self` are two keys, not one key with a flag.

**A permission key is never deleted, only stopped being granted.** Deleting a key means `PermissionRegistry.isKnown()` starts rejecting rows that already exist in `role_permissions`, which is correct behaviour and a confusing way to discover the change. Remove the grants first, in a migration, then remove the key in a later release.

---

## Step 8.2 — `PermissionRegistry`

**`packages/permissions/src/registry/permission-registry.ts`**

```ts
import { CATALOG } from "./catalog/index.js";

export type PermissionScope = "org" | "goal";

export interface PermissionMeta {
  readonly scope: PermissionScope;
  readonly module: string;
  readonly label: string;
}

export type PermissionKey = keyof typeof CATALOG;

export class PermissionRegistry {
  public static readonly instance = new PermissionRegistry();

  private constructor() {}

  public all(): readonly PermissionKey[] {
    return ALL_KEYS;
  }

  // `undefined` rather than a throw for a key the catalog does not define. The type
  // rules this out at compile time; a cast or a stale DTO does not.
  public meta(key: PermissionKey): PermissionMeta | undefined {
    return Object.hasOwn(CATALOG, key) ? CATALOG[key] : undefined;
  }

  public scopeOf(key: PermissionKey): PermissionScope | undefined {
    return this.meta(key)?.scope;
  }

  public byModule(module: string): readonly PermissionKey[] {
    return BY_MODULE.get(module) ?? NO_KEYS;
  }

  // Permission strings from the database must pass this before they are trusted.
  //
  // `Object.hasOwn`, not `value in CATALOG`: `in` walks the prototype chain, so a
  // stored row reading `constructor` or `toString` would pass and then resolve to
  // a `PermissionMeta` of `undefined`, whose `scope` check falls through to the
  // org branch and grants a permission that does not exist.
  public isKnown(value: string): value is PermissionKey {
    return Object.hasOwn(CATALOG, value);
  }

  public modules(): readonly string[] {
    return [...new Set(this.all().map((k) => CATALOG[k].module))];
  }
}
```

**`isKnown()` earns its place immediately.** Role grants, per-user overrides, and API-key scopes all arrive from the database as raw strings. A stale row must never grant something the registry no longer defines. Every one of those paths filters through `isKnown()` before the string becomes a `PermissionKey` — that type predicate is the boundary between untrusted text and the typed vocabulary.

> [!CAUTION]
> **`value in CATALOG` does not hold that boundary** — verified by a failing test. `CATALOG` is an object literal, so it inherits from `Object.prototype` and `"constructor" in CATALOG` is `true`. A `role_permissions` row reading `constructor` then passes `isKnown()`, narrows to `PermissionKey`, and lands in a grant set; `scopeOf` reads `undefined`, `undefined === "goal"` is false, the org branch finds the string in the grants set, and `can()` returns **`true`** for a permission that does not exist. `Object.hasOwn` checks own properties only. `all()`, `byModule()`, and `modules()` were never affected — they go through `Object.keys`.

### The same input crashed instead of granting

Closing the *grant* path left the *crash* path open. `scopeOf` read `CATALOG[key].scope` blind, so a
key the catalog does not define was a `TypeError` rather than `undefined` — verified:

```
can("task.archive") → TypeError: Cannot read properties of undefined (reading 'scope')
```

**The trigger is a deploy, not an attack.** Delete a permission from `CATALOG` and `CapabilityCache`
still holds pre-deletion DTOs in Redis for up to its sixty-second TTL ([16](16-auth-package.md)) — so
those users get **500s instead of 403s** for a minute, and `visibleModules()` takes the whole
navigation down with them. So `meta()` and `scopeOf()` return `| undefined`, and `can()` treats that
as a denial.

### Derived views are computed once

`CATALOG` is a compile-time constant, so every view of it is built at module load and returned frozen:

```ts
const ALL_KEYS: readonly PermissionKey[] = Object.freeze(Object.keys(CATALOG) as PermissionKey[]);
const BY_MODULE: ReadonlyMap<string, readonly PermissionKey[]> = /* grouped once */;
const MODULES: readonly string[] = Object.freeze([...BY_MODULE.keys()]);
const NO_KEYS: readonly PermissionKey[] = Object.freeze([]);
```

`visibleModules()` and an admin permission matrix both call into these per render. Module-level consts
rather than `static readonly` members holding a `Map`, because a `static` field holding a mutable
`Map` is the exact shape the static-mutable-state ban exists to catch ([05](05-lint-and-format.md)).

**`PermissionRegistry.instance` is `static readonly`**, which satisfies the static-mutable-state ban in [05](05-lint-and-format.md). It holds no state; the singleton exists so call sites read `PermissionRegistry.instance.isKnown(x)` rather than constructing one each time.

**Scope is a property of the permission, not of the check.** `goal.create` is org-scoped because you create a goal before it exists; `goal.update` is goal-scoped because it operates on one. Getting this wrong is the most common modelling error here, and the symptom is `can()` returning `false` for someone who should obviously have access — because a goal-scoped permission was asked without a `goalId`.

---

## Step 8.3 — `ModuleRegistry`

The permission catalog answers "may this actor do X." The module registry answers "should this actor see the finance section at all," which is a different question with a different owner.

### The route table comes first

A gate names a destination, so the destinations have to exist before the gates do. They live in a third fragment folder beside `catalog/` and `gate/`, following the same team-owned/platform-owned split:

**`packages/permissions/src/route/index.ts`**

```ts
import { rbacRoutes } from "./rbac.routes.js";
import { shellRoutes } from "./shell.routes.js";

// Every declared path is rooted — a missing leading slash fails to compile.
export type RoutePath = `/${string}`;

export const ROUTES = {
  shell: shellRoutes,
  rbac: rbacRoutes,
  // ...task: taskRoutes,
} as const;

export type AppRoute = {
  [G in keyof typeof ROUTES]: Extract<(typeof ROUTES)[G][keyof (typeof ROUTES)[G]], string>;
}[keyof typeof ROUTES];
```

**`packages/permissions/src/route/rbac.routes.ts`** — team-owned, one per slice:

```ts
import type { RoutePath } from "./index.js";

export const rbacRoutes = {
  roles: "/settings/roles",
  members: "/settings/members",
} as const satisfies Record<string, RoutePath>;
```

`shell.routes.ts` is the one fragment that is not a slice — `home`, `signIn`, `forbidden`, platform-owned, and a feature team never opens it.

**Why the table rather than the router's generated route tree.** Deriving paths from `RoutePaths<typeof routeTree>` is the obvious alternative and it fails twice. A Nest process has no route tree at all, and the web, desktop, and Next shells each generate a *different* one — so a generated type can check one shell but can never be what all of them agree on. And nobody reads codegen: "what screens does this product have" should be answerable by opening one file. The generated tree is still useful, but as a *checker* pointed at the table, never as its source ([30](30-desktop-app.md)).

The same paper cycle as the catalog applies — the fragment imports `RoutePath` from the barrel that imports it back, as `import type`, so nothing survives to run.

**`packages/permissions/src/gate/rbac.gate.ts`** — a gate names a route rather than spelling one:

```ts
import type { ModuleGate } from "../module-registry.js";
import { ROUTES } from "../route/index.js";

export const rbacGates = {
  rbac: { permission: "rbac.role.read", route: ROUTES.rbac.roles },
  member: { permission: "member.read", route: ROUTES.rbac.members },
} as const satisfies Record<string, ModuleGate>;
```

**`packages/permissions/src/gate/index.ts`** — platform-owned, mirrors the catalog barrel:

```ts
import { rbacGates } from "./rbac.gate.js";

export const GATES = {
  ...rbacGates,
  // ...taskGates,
  // ...financeGates,
} as const;
```

**`packages/permissions/src/registry/module-registry.ts`**

```ts
import type { CapabilitySet } from "../capability/index.js";
import { GATES } from "./gate/index.js";
import type { PermissionKey } from "./permission-registry.js";
import type { AppRoute } from "./route/index.js";

export interface ModuleGate {
  readonly permission: PermissionKey;
  // `AppRoute`, not `string` — a gate pointing at an undeclared path fails to compile.
  readonly route: AppRoute;
}

export type ModuleKey = keyof typeof GATES;

export class ModuleRegistry {
  public static readonly instance = new ModuleRegistry();

  private constructor() {}

  public gate(module: ModuleKey): ModuleGate {
    return GATES[module];
  }

  public isVisible(module: ModuleKey, caps: CapabilitySet): boolean {
    return caps.can(GATES[module].permission);
  }

  public visibleModules(caps: CapabilitySet): readonly ModuleKey[] {
    return (Object.keys(GATES) as ModuleKey[]).filter((m) => this.isVisible(m, caps));
  }
}
```

**Why this is a separate registry.** `@loadbearing/content` owns the navigation menu — its labels, order, and icons — and a content editor may change all three. What an editor must *not* be able to change is which permission gates a module or where its route points. So `nav.data.ts` in `content` carries `module: "finance"`, never `permission: "finance.read.global"`, and `ModuleRegistry` maps that key to its gate — which is also why the route table lives in this package rather than in a shell: where a module points is a trusted, code-owned decision, not editable content. `content` may import `ModuleKey` as a type and must never reference `PermissionKey` at all — a rule the root ESLint config enforces explicitly for that package ([20](20-content-package.md)).

---

## Step 8.4 — `CapabilitySet`

**`packages/permissions/src/capability/capability-set.ts`**

```ts
import { type PermissionKey, PermissionRegistry } from "../registry/permission-registry.js";

export interface ScopedSetDto {
  readonly grants: readonly PermissionKey[];
  readonly denies: readonly PermissionKey[];
}

export interface CapabilitySetDto {
  readonly wildcard: boolean;
  readonly org: ScopedSetDto;
  readonly goals: Readonly<Record<string, ScopedSetDto>>;
}

class ScopedSet {
  private readonly grants: ReadonlySet<PermissionKey>;
  private readonly denies: ReadonlySet<PermissionKey>;

  public constructor(dto: ScopedSetDto) {
    this.grants = new Set(dto.grants);
    this.denies = new Set(dto.denies);
  }

  public grantsPermission(p: PermissionKey): boolean {
    return this.grants.has(p);
  }

  public deniesPermission(p: PermissionKey): boolean {
    return this.denies.has(p);
  }
}

// Resolved capabilities for one principal — user or API key, same shape.
export class CapabilitySet {
  private readonly orgSet: ScopedSet;
  private readonly goalSets: ReadonlyMap<string, ScopedSet>;

  private constructor(private readonly dto: CapabilitySetDto) {
    this.orgSet = new ScopedSet(dto.org);
    this.goalSets = new Map(
      Object.entries(dto.goals).map(([id, s]): [string, ScopedSet] => [id, new ScopedSet(s)]),
    );
  }

  public static from(dto: CapabilitySetDto): CapabilitySet {
    return new CapabilitySet(dto);
  }

  public static empty(): CapabilitySet {
    return new CapabilitySet({ wildcard: false, org: { grants: [], denies: [] }, goals: {} });
  }

  private static union(a: readonly PermissionKey[], b: readonly PermissionKey[]): PermissionKey[] {
    return [...new Set([...a, ...b])];
  }

  // Deny by default. An explicit deny beats every grant, including the wildcard.
  public can(permission: PermissionKey, goalId?: string): boolean {
    const scope = PermissionRegistry.instance.scopeOf(permission);
    if (!scope) return false;

    if (scope === "goal") {
      if (!goalId) return false;
      const goal = this.goalSets.get(goalId);
      if (goal?.deniesPermission(permission)) return false;
      if (this.orgSet.deniesPermission(permission)) return false;
      if (this.dto.wildcard) return true;
      return (
        (goal?.grantsPermission(permission) ?? false) || this.orgSet.grantsPermission(permission)
      );
    }

    return this.allowsAtOrg(permission);
  }

  public canAll(permissions: readonly PermissionKey[], goalId?: string): boolean {
    return permissions.every((p) => this.can(p, goalId));
  }

  public canAny(permissions: readonly PermissionKey[], goalId?: string): boolean {
    return permissions.some((p) => this.can(p, goalId));
  }

  // Goals in which this principal holds a given goal-scoped permission.
  public goalsWith(permission: PermissionKey): readonly string[] {
    return [...this.goalSets.keys()].filter((id) => this.can(permission, id));
  }

  // Narrow this set to the intersection with another. Used when an API key's
  // scopes are re-intersected with its issuer's live capabilities at resolution.
  //
  // Denies union, grants intersect, goal keys union, and both sides' grants are
  // candidates. See the four notes below — each one is a way this method leaked
  // or over-narrowed before.
  public intersect(other: CapabilitySet): CapabilitySet {
    const goalIds = new Set([...Object.keys(this.dto.goals), ...Object.keys(other.dto.goals)]);
    const orgCandidates = CapabilitySet.union(this.dto.org.grants, other.dto.org.grants);

    return CapabilitySet.from({
      wildcard: this.dto.wildcard && other.dto.wildcard,
      org: {
        grants: orgCandidates.filter((p) => this.allowsAtOrg(p) && other.allowsAtOrg(p)),
        denies: CapabilitySet.union(this.dto.org.denies, other.dto.org.denies),
      },
      goals: Object.fromEntries(
        [...goalIds].map((goalId): [string, ScopedSetDto] => {
          const mine = this.dto.goals[goalId];
          const theirs = other.dto.goals[goalId];

          return [
            goalId,
            {
              grants: CapabilitySet.union(mine?.grants ?? [], theirs?.grants ?? []).filter(
                (p) => this.can(p, goalId) && other.can(p, goalId),
              ),
              denies: CapabilitySet.union(mine?.denies ?? [], theirs?.denies ?? []),
            },
          ];
        }),
      ),
    });
  }

  public toJSON(): CapabilitySetDto {
    return this.dto;
  }

  // `can()` for an org-scoped permission — and the org half of a goal-scoped one.
  private allowsAtOrg(permission: PermissionKey): boolean {
    if (this.orgSet.deniesPermission(permission)) return false;
    if (this.dto.wildcard || CapabilitySet.isCore(permission)) return true;
    return this.orgSet.grantsPermission(permission);
  }

  // The one exception to deny-by-default, and it is checked after denies like the
  // wildcard is — see docs/reference/capability-set.md.
  private static isCore(permission: PermissionKey): boolean {
    return PermissionRegistry.instance.meta(permission)?.module === CORE_MODULE;
  }
}
```

### The six resolution rules

1. **Deny by default.** Absence of a grant is a denial. There is no "allow unless denied" path, except the closed module named in rule 6.
2. **Explicit deny beats every grant**, including the wildcard. This is what makes per-user overrides usable as a suspension mechanism without unpicking role assignments.
3. **A goal-scoped permission with no `goalId` is `false`.** Not an error, not a throw — `false`. This makes forgetting the scope fail closed.
4. **Wildcard is checked after denies.** A superuser who has been explicitly denied one permission is denied it.
5. **A permission the catalog does not define is denied**, not thrown on. Same reasoning as rule 3: a permission check that raises a `TypeError` turns a 403 into a 500, and takes the navigation with it.
6. **Every `core.*` permission is held by any resolved principal**, checked beside the wildcard so rule 2 still wins. `core.activity.write` describes acting at all: a role that granted it would be a role that could be missing it, and for a while only `owner`'s wildcard carried it while one use-case asserted it. See [Reference · capability-set](../../packages/permissions/docs/reference/capability-set.md).

### `goalsWith()` does more work than it looks

Escalation that resolves targets *by permission rather than by role* is this method. "A manager sees capacity only within their own goals" is this method. Per-recipient digest filtering is this method. Writing it once, on the class that owns the data, is what makes "no hardcoded role checks" true rather than aspirational — the alternative is a `WHERE role = 'manager'` in three different query files that drift apart.

**It takes the candidate goals as a required parameter**, because the object cannot produce them. It knows only the goals its own DTO names, and two principal shapes hold a goal-scoped permission in goals that never appear there — a wildcard holder, and anyone granted it at org level.

Filtering its own `goals` keys answered `[]` for both while `can()` answered `true`. That fed an empty permitted scope into `VectorStore.search()`, where empty means org-wide chunks only ([14](14-vector-store.md)) — so a superuser asking about a project's documents got nothing relevant and **no error**. Fail-closed and silently wrong is harder to diagnose than a refusal.

```ts
public goalsWith(permission: PermissionKey, amongGoalIds: readonly string[]): readonly string[] {
  return [...new Set(amongGoalIds)].filter((id) => this.can(permission, id));
}
```

Delegating to `can()` makes all four shapes correct for free, and it mirrors `VectorStore.search()` itself, where `goalIds` is required so the permitted scope cannot be forgotten ([12](12-application-package.md)).

### `intersect()` and the API-key model

An API key is a principal whose capability set cannot exceed its issuer's. Intersecting at creation is the obvious half. Re-intersecting **at resolution** is the half that matters: when the issuer's permission is revoked, every key they created narrows on the next request rather than at the next key rotation. That closes the most common way an RBAC model gets quietly defeated. See [16](16-auth-package.md).

Which makes this the one method in the package that is a security boundary rather than a convenience, and it has to be correct in four ways the obvious implementation is not. All four are proven by tests in `tests/capability-set.spec.ts` — write the naive body and exactly those tests go red.

| Rule | Naive version | What breaks |
| --- | --- | --- |
| **Denies union** | keeps only `this.dto.org.denies` | two wildcard sets produce one that grants what the other explicitly refused — a privilege escalation, not a rounding error |
| **Goal keys union** | iterates `Object.entries(this.dto.goals)` | a deny inside a goal `this` has never heard of is discarded entirely |
| **Org candidates via `allowsAtOrg`** | filters org grants through `other.can(p)` | rule 3 makes that `false` for every goal-scoped key, so an org-level grant of one is dropped and `intersect` is not even idempotent |
| **Both sides' grants are candidates** | filters only `this.dto.org.grants` | a wildcard set lists nothing, so it intersects down to nothing — an issuer who has lost superuser leaves their keys dead instead of narrowed |

The last one is the realistic case rather than a contrived one: an issuer who *was* a superuser created a wildcard key and has since lost superuser. The key must narrow to the issuer's current explicit grants — not to nothing, and certainly not stay wildcard. Taking the union of both sides' grants as the candidate set and keeping each key only where both sides allow it makes this a real set intersection, and makes it answer the same whichever side is narrowed.

### `from()` is where the vocabulary boundary holds

A DTO reaches `from()` from three places — the database, a Redis cache entry, and an SSR payload — and
only the first has already been filtered through `isKnown()`. So `from()` re-filters every set, which
makes that boundary true on all three paths instead of one. Without it, a cache entry written before a
permission was deleted (or a tampered one) puts a key straight into a grant set.

Two details matter:

- **The sanitised DTO is what gets stored**, not the caller's. `toJSON()` returns it by reference, so
  keeping the original would write the dropped keys straight back out to the cache on the next fill —
  the bug would survive its own fix.
- **A goal key survives even when every permission inside it was dropped**, because an empty goal entry
  is still meaningful to `intersect()`, which unions goal keys across both sides.

`intersect()` builds through `from()` too, on sets already known to be clean. The redundant filter is
a few keys' worth of work, and worth it to keep one entry point rather than a trusted back door.

### `toJSON()` / `from()` is why one class serves four runtimes

The DTO is plain JSON. The server resolves a `CapabilitySet` from the database, serialises it into the SSR payload, and the browser reconstructs the identical class. The `<Can>` component and the oRPC handler then run the *same* `can()` — not two implementations that agree today. The worker and the desktop app do the same. That identity is the entire point of the package.

---

## Step 8.5 — Tests

The package needs its own runner config first — pointed at `tests/`, since without an explicit
`include` vitest's default also walks `dist/`:

**`packages/permissions/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.spec.ts"] },
});
```

And `tests/**` belongs in this package's tsconfig `include` too, or `pnpm typecheck` skips the specs
entirely — see [07](07-core-package.md#step-76--a-first-test) for the convention in full.

**`packages/permissions/tests/capability/capability-set.spec.ts`** — the shape; the shipped file carries fourteen cases, including one per `intersect` rule above.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet } from "../src/capability-set.js";
import { PermissionRegistry } from "../src/permission-registry.js";

const GOAL = "018f8c00-0000-7000-8000-000000000001";

// Every key the shipped catalog defines is org-scoped, so the goal-scoped branch
// of `can()` is unreachable through it. Stubbing `scopeOf` tests that branch now
// instead of leaving rule 3 unverified until a slice adds a goal-scoped key.
const treatEveryKeyAsGoalScoped = (): void => {
  vi.spyOn(PermissionRegistry.instance, "scopeOf").mockReturnValue("goal");
};

describe("CapabilitySet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("denies by default", () => {
    expect(CapabilitySet.empty().can("rbac.role.read")).toBe(false);
  });

  it("denies a goal-scoped permission asked without a goalId", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: ["rbac.role.read"], denies: [] },
      goals: { [GOAL]: { grants: ["rbac.role.read"], denies: [] } },
    });

    expect(caps.can("rbac.role.read")).toBe(false);
    expect(caps.can("rbac.role.read", GOAL)).toBe(true);
  });

  it("lets an explicit deny beat the wildcard", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: ["rbac.role.manage"] },
      goals: {},
    });

    expect(caps.can("rbac.role.manage")).toBe(false);
    expect(caps.can("rbac.role.read")).toBe(true);
  });

  it("round-trips through JSON", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: { [GOAL]: { grants: [], denies: [] } },
    });
    const revived = CapabilitySet.from(
      JSON.parse(JSON.stringify(caps.toJSON())) as ReturnType<typeof caps.toJSON>,
    );

    expect(revived.can("member.read")).toBe(true);
  });
});
```

The round-trip test is the one that protects the architecture. If it ever fails, the server and the browser have stopped agreeing about permissions.

Two details in that listing are not stylistic:

- **The cast on `JSON.parse` is required.** It returns `any`, and `@typescript-eslint/no-unsafe-argument` — on via `recommendedTypeChecked` in [05](05-lint-and-format.md) — rejects passing it straight into `from()`.
- **`treatEveryKeyAsGoalScoped` exists because rule 3 is otherwise untestable.** Every key in the shipped catalog is org-scoped, so the original listing's "denies a goal-scoped permission asked without a goalId" asserted `can("rbac.role.read") === true` on an org-scoped key — it tested the opposite of its name and left the fail-closed branch unverified. Stubbing the one method `can()` consults reaches the real branch without inventing catalog keys that belong to [13](13-infrastructure-postgres.md).

`tests/permission-registry.spec.ts` and `tests/module-registry.spec.ts` are worth the same treatment — `isKnown()` is a security boundary and `visibleModules()` is what the whole navigation renders from. Twenty-three tests total.

---

## Step 8.6 — The barrels

Five folders, so five folder barrels and one root barrel that names only those
([Opinions · Folders](../opinions/folders.md)).

**`packages/permissions/src/registry/index.ts`**

```ts
export { type ModuleGate, type ModuleKey, ModuleRegistry } from "./module-registry.js";
export {
  type PermissionKey,
  type PermissionMeta,
  PermissionRegistry,
  type PermissionScope,
} from "./permission-registry.js";
```

**`packages/permissions/src/capability/index.ts`**

```ts
export { CapabilitySet, type CapabilitySetDto, type ScopedSetDto } from "./capability-set.js";
```

**`packages/permissions/src/index.ts`**

```ts
export { CapabilitySet, type CapabilitySetDto, type ScopedSetDto } from "./capability/index.js";
export { CATALOG } from "./catalog/index.js";
export { GATES } from "./gate/index.js";
export {
  type ModuleGate,
  type ModuleKey,
  ModuleRegistry,
  type PermissionKey,
  type PermissionMeta,
  PermissionRegistry,
  type PermissionScope,
} from "./registry/index.js";
export { type AppRoute, ROUTES, type RoutePath } from "./route/index.js";
```

`CATALOG` and `GATES` are on the list deliberately — the seed script and the permission matrix UI both iterate them. Under `export *` they were public by accident, which is the difference the named list makes visible.

---

## ✅ Gate

- A misspelled `PermissionKey` is a **compile error**, not a runtime `false`. Verified — `caps.can("rbac.role.reed")` gives `TS2820: Did you mean '"rbac.role.read"'?`, and `ModuleRegistry.instance.gate("finance")` gives `TS2345: not assignable to parameter of type '"rbac" | "member"'`. The literal unions survive both barrels' spreads.
- `CapabilitySet.from(caps.toJSON())` round-trips.
- `pnpm --filter @loadbearing/permissions typecheck` is clean and `test` passes — 39 tests.
- `pnpm exec biome check packages/permissions` and `pnpm exec eslint packages/permissions/src` are both clean. There is no per-package `lint` script; that gate is root-only.
- `pnpm --filter @loadbearing/permissions build` emits `dist/index.d.ts` exporting all of `AppRoute`, `CATALOG`, `CapabilitySet`, `CapabilitySetDto`, `GATES`, `ModuleGate`, `ModuleKey`, `ModuleRegistry`, `PermissionKey`, `PermissionMeta`, `PermissionRegistry`, `PermissionScope`, `ROUTES`, `RoutePath`, `ScopedSetDto`.
- `can()` **denies** an unrecognised key rather than throwing, and `from()` drops one. Verified:

  ```ts
  CapabilitySet.from({ wildcard: false, org: { grants: ["task.archive"], denies: [] }, goals: {} })
  // .can("task.archive")        → false, no throw
  // .toJSON().org.grants        → []
  ```
- The package has **no `dependencies`** — only `devDependencies`. It is a true leaf.

Do not proceed until this passes.

---

[← `@loadbearing/core`](07-core-package.md) · [`@loadbearing/errors` →](09-errors-package.md)
