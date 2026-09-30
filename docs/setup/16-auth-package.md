# 16 · `@loadbearing/auth`

> Better Auth, self-hosted, in its own server-only package. Authentication only — every authorization decision stays in `CapabilitySet`.

**Delivers:** One identity layer serving the web app, the desktop app, a client portal, and API-key integrations, all collapsing into the single `Principal` the rest of the system already understands.

**Prerequisite:** [15 · `@loadbearing/infrastructure`](15-infrastructure-package.md)

---

## Decisions at a glance

| Question | Answer |
|---|---|
| Library | Better Auth, self-hosted, tables in your own Postgres |
| Package | One — `packages/auth`, server-only. Not two |
| Roles / permissions | **Not** Better Auth's. `PermissionRegistry` and `CapabilitySet` keep that job |
| Organization plugin | No. You own `organizations`, `memberships`, and `goal_members` |
| Session transport | Cookie (web) **and** bearer token (desktop) from day one |
| API keys | Your own implementation, not the plugin's session mocking |
| Session storage | Postgres owns the record; Redis is a read-through cache in front of it |
| Client-side session | Through `@loadbearing/query`, not Better Auth's React hooks |
| Schema | Yours. Plural tables, `uuid` primary keys, and three columns Better Auth never heard of |
| Identifiers | `Uuid.v7()`, configured — not Better Auth's opaque string |

---

## What Better Auth owns, and what it does not

**It owns** password hashing, session issuance and rotation, email verification, password reset, OAuth account linking, two-factor, and bearer tokens — all the boring, security-critical machinery you do not want to write.

**It does not own authorization.** Better Auth ships an organization plugin with its own `createAccessControl` and role definitions. **Do not use it.** The architecture's strongest claim is that there is no second security model to keep in sync; adopting its roles gives you exactly that — one permission model in `PermissionRegistry`, another in the auth library, drifting apart the first time someone edits only one.

**Skip the organization plugin entirely.** `memberships` and `goal_members` already exist ([13](13-infrastructure-postgres.md)) and point at your own `roles` table. The plugin would add a parallel `member.role` string column meaning something different, and reconciling the two is worse than not having it.

**Do not use the API-key plugin's session mocking.** It mints a session for a key, which means a leaked key impersonates a full user with that user's live permissions. The model in Step 16.6 is strictly better: a key is a principal with its own capability set that cannot exceed its issuer's, re-intersected on every request.

---

## Layout

```
packages/auth/src/
├── index.ts                              ← ServerOnly.assert()
├── import.ts                             ← every external symbol, better-auth included
├── factory/
│   ├── auth.config.ts                    → AuthConfig
│   └── auth.factory.ts                   → AuthFactory.create(...)
├── session/
│   ├── index.ts
│   ├── better-auth-session.resolver.ts   → BetterAuthSessionResolver
│   └── membership.reader.ts              → MembershipReader
├── principal/
│   ├── index.ts
│   ├── principal.builder.ts              → PrincipalBuilder
│   └── capability.cache.ts               → CapabilityCache
├── apikey/
│   ├── index.ts
│   ├── api-key.hasher.ts                 → ApiKeyHasher
│   └── api-key.resolver.ts               → ApiKeyResolver
└── tables/
    └── index.ts                          ← prints what the pinned runtime expects
```

**Depends on** `core`, `contracts`, `permissions`, `application`, `infrastructure`.
**Used by** `composition` only. Never by `apps/web`'s component tree.

The **client** side of auth does not live here. Better Auth's client is a thin fetch wrapper around endpoints, and `@loadbearing/api-client` is the package whose entire job is "how to reach the server." See [18](18-api-client-package.md).

---

## Step 16.1 — The auth schema is yours

**Do not run `@better-auth/cli generate`.** It is published from a different release line than the library and trails it — 1.4.21 against a 1.6.26 runtime at the time of writing — so a generator two minors behind writes a schema missing the fields the installed version actually reads. That is wrong in the worst available way: it typechecks, migrates cleanly, and fails on a query nobody runs until production.

Author the schema instead, and check it against the runtime rather than against a generator.

**`packages/auth/package.json`**

```json
"scripts": {
  "auth:tables": "tsx tables.ts"
}
```

**`packages/auth/tables.ts`** builds the auth instance through `AuthFactory` — never a second copy of the options, which would describe an instance that does not exist — and prints what it needs:

```ts
import { getSchema } from "better-auth/db";

for (const [model, table] of Object.entries(getSchema(auth.options))) {
  console.log(`\n${model}`);
  for (const [field, attribute] of Object.entries(table.fields)) {
    console.log(`  ${field.padEnd(24)} ${attribute.type}`, /* flags */);
  }
}
```

`getSchema` is the same function the CLI calls, taken from the version actually installed — so it cannot skew, because only one version is involved. Nothing connects: `new Pool()` is lazy and no query is issued, so this runs without Postgres.

```bash
pnpm --filter @loadbearing/auth run auth:tables
```

Run it after every Better Auth upgrade and diff the output against `packages/infrastructure/src/pg/schema/auth.schema.ts`. That is the whole maintenance procedure.

### What goes in the schema

Five models — `users`, `sessions`, `accounts`, `verifications`, `twoFactors` — written like every other table here: plural, snake_case columns, `uuid` primary keys, in `packages/infrastructure/src/pg/schema/auth.schema.ts` and exported from `schema/index.ts`. Step 16.2 configures the library to accept those names.

> [!IMPORTANT]
> **The Drizzle export names and property keys are load-bearing; the SQL names are not.** The adapter resolves a column by looking up `schema[modelName][fieldName]`, so each export must match a `modelName` from Step 16.2 and each property must match a Better Auth field name. Rename an export and authentication fails at runtime with a message about a missing Drizzle schema. Rename a *column* and nothing happens at all — which is why the columns are snake_case and the properties are not.

**The foreign keys are declared in the schema, never in a hand-authored migration.** drizzle-kit generates by diffing the schema against the migration history, so a constraint it cannot see is a constraint the next generated migration drops — silently, inside a migration that was supposed to be about something else. `memberships`, `goal_members`, `permission_overrides` and `api_keys.issuer_id` all carry `.references(() => users.id, { onDelete: "cascade" })` in [13](13-infrastructure-postgres.md), and that is the only place they exist.

```bash
pnpm db:generate && pnpm db:migrate
```

Deleting a user cascades their role assignments, which is what you want. It also means there is exactly one users table — a claim worth being able to make.

> [!WARNING]
> **If you are adding this to a database that already has rows,** the generated migration will contain bare `ALTER COLUMN "user_id" SET DATA TYPE uuid` statements. Postgres rejects those on a populated `text` column; add `USING "user_id"::uuid` to each. Editing generated SQL is safe here — drizzle-kit reads its snapshots, not the migration bodies — and it is the one edit this chapter asks for.

**Cover every foreign key with an index.** Postgres does not create one, and without it each `ON DELETE CASCADE` scans the whole referencing table. `sessions_user_idx`, `sessions_organization_idx`, `accounts_user_idx` and `two_factors_user_idx` exist for that reason; `sessions_expires_idx` is what makes the expiry sweep below cheap, and `sessions_user_surface_idx` is what makes "revoke this person's desktop sessions" a lookup rather than a scan.

> **`sessions` is not partitioned, and that is deliberate.** It looks like a third append-only table next to `activity_log` and `task_status_history`, and it is not one: Better Auth updates a row on refresh, deletes it on sign-out, and looks rows up by id — a predicate carrying no partition key, so every lookup would scan every partition. Partitioning would also require a composite primary key including the partition column, which the library's own id lookups do not supply.
>
> Sessions are bounded by expiry instead. A nightly `DELETE FROM sessions WHERE expires_at < now()` on the cleanup schedule ([25](25-worker-app.md)) keeps the table small, which is the outcome partitioning would have been for. See [Data and scale](../opinions/data-and-scale.md) §4.2.

---

## Step 16.2 — `AuthConfig` and `AuthFactory`

**`packages/auth/src/factory/auth.config.ts`**

```ts
export interface AuthConfig {
  readonly secret: string;
  readonly baseUrl: string;
  readonly trustedOrigins: readonly string[];
  readonly sessionMaxAgeSeconds: number;
  readonly cookieCacheMaxAgeSeconds: number;
  readonly requireEmailVerification: boolean;
}
```

**Every value comes from the environment**, through `ContainerConfig` ([24](24-web-app.md)). None of them are literals in the factory: session lifetime differs between a staging box and production, and burying it in code makes it a deploy rather than a variable.

**`packages/auth/src/factory/auth.factory.ts`**

```ts
export class AuthFactory {
  private constructor() {}

  public static create(
    config: AuthConfig,
    database: Database,
    cache: CacheStore,
    memberships: MembershipReader,
  ) {
    const options = {
      secret: config.secret,
      baseURL: config.baseUrl,
      trustedOrigins: [...config.trustedOrigins],

      database: drizzleAdapter(database.client, { provider: "pg" }),

      emailAndPassword: {
        enabled: true,
        requireEmailVerification: config.requireEmailVerification,
        revokeSessionsOnPasswordReset: true,
      },

      // `modelName` is what the Drizzle adapter looks up, so these five names *are*
      // the export names in `auth.schema.ts`. Field names need no mapping: Better
      // Auth's are already camelCase, which is the convention here too.
      user: {
        modelName: "users",
        additionalFields: {
          locale: { type: "string", required: false, defaultValue: "en" },
          timezone: { type: "string", required: false },
          deactivatedAt: { type: "date", required: false, input: false },
        },
      },

      account: { modelName: "accounts" },

      session: {
        modelName: "sessions",
        expiresIn: config.sessionMaxAgeSeconds,
        updateAge: Math.floor(config.sessionMaxAgeSeconds / 4),

        // NOT a default — see below. Without it, Redis owns the session record.
        storeSessionInDatabase: true,

        cookieCache: {
          enabled: true,
          maxAge: config.cookieCacheMaxAgeSeconds,
        },

        // Pinned at sign-in, never accepted from the client.
        additionalFields: {
          activeOrganizationId: { type: "string", required: true, input: false },
          surface: { type: "string", required: true, input: false },
        },
      },

      // NOT a default either, and the same failure one table over.
      verification: {
        modelName: "verifications",
        storeInDatabase: true,
      },

      advanced: {
        cookiePrefix: "ratchet",
        database: { generateId: (): string => Uuid.v7() },
        defaultCookieAttributes: {
          httpOnly: true,
          sameSite: "lax",
          secure: config.baseUrl.startsWith("https://"),
        },
      },

      rateLimit: {
        enabled: true,
        window: 60,
        max: 20,
        storage: "secondary-storage",
      },

      // Redis in FRONT of Postgres, never instead of it.
      secondaryStorage: {
        get: async (key) => cache.get<string>(`auth:${key}`),
        set: async (key, value, ttl) => cache.set(`auth:${key}`, value, ttl ?? 300),
        delete: async (key) => cache.delete(`auth:${key}`),
      },

      databaseHooks: {
        session: {
          create: {
            before: async (session, context) => {
              const organizationId = await memberships.activeOrganizationFor(
                session.userId as UserId,
              );
              if (!organizationId) return false;

              const origin = context?.request?.headers.get("origin") ?? null;
              return {
                data: {
                  ...session,
                  activeOrganizationId: organizationId,
                  surface: surfaceOf(origin),
                },
              };
            },
          },
        },
      },

      plugins: [bearer(), twoFactor({ schema: { twoFactor: { modelName: "twoFactors" } } })],
    } satisfies BetterAuthOptions;

    return betterAuth(options);
  }
}

// Read back off the factory, not annotated. See below.
export type AuthInstance = ReturnType<typeof AuthFactory.create>;
```

> Better Auth's option names move between minor versions. Check the current documentation for `secondaryStorage`, `cookieCache`, and the plugin signatures against the version your catalog pins. The *shape* above — Drizzle adapter, cookie cache on, Redis secondary storage, bearer enabled — is what matters and is stable.

### The two defaults that quietly invert this design

> [!CAUTION]
> **Configuring `secondaryStorage` silently transfers ownership of sessions to Redis.** `storeSessionInDatabase` defaults to `false`, and with secondary storage present Better Auth stops writing the `sessions` row at all. Every sentence in this chapter about Postgres owning the record and Redis being a read-through in front of it is false without that one line — and the instance it lands on runs `allkeys-lru` ([15](15-infrastructure-package.md)), so an ordinary eviction under memory pressure becomes a random sign-out with no error anywhere.
>
> **`verification.storeInDatabase` is the same trap one table over.** Left at its default, the `verifications` table is never created at all and email-verification and password-reset tokens live in Redis alone. An eviction there is a reset link that stops working, silently, for a user who is already locked out. Better Auth's own source carries a TODO acknowledging this is a problem for security-sensitive paths.
>
> Both are one line. Neither is discoverable from a failing test, because nothing fails until memory pressure arrives.

### The rest of the configuration

**Identifiers are `Uuid.v7()`, not Better Auth's default.** `advanced.database.generateId` is what makes `user_id` a real `uuid` foreign key throughout [13](13-infrastructure-postgres.md) rather than a `text` column shaped around a foreign format — and it is what makes the branded `UserId` in `contracts`, declared `z.uuid()`, true rather than aspirational.

**`AuthInstance` is read back off the factory, never annotated.** `ReturnType<typeof betterAuth>` is `Auth<BetterAuthOptions>` — the *unconfigured* instance — and the two-factor plugin widens the user type, so annotating `create()` with it fails to assign. The type has to be inferred from these options and exported afterwards.

**The bearer plugin is not optional.** The desktop shell is Tauri ([30](30-desktop-app.md)), its webview runs on a custom `tauri://localhost` origin (`http://tauri.localhost` on Windows), and a session cookie is never sent cross-origin. So it needs a token, and enabling the plugin costs one array element here versus touching every endpoint, guard, and test later.

**Cookie cache on, with a short TTL.** Better Auth can store signed session data in the cookie itself, so most requests skip the session lookup entirely. This is the single biggest performance win available here and it costs one config block. **Sixty seconds, and no longer** — revocation only takes effect when the cookie cache expires, so this value *is* the revocation window, and it is capped by the same rule that caps the capability cache below. That ceiling is enforced in the env schema ([24](24-web-app.md)), not by this paragraph.

**Rate-limit counters share the cache instance, and there the failure is benign:** a lost counter means someone gets a few extra attempts, not a lockout. That is the test for what may live on an evicting store, and it is precisely the test sessions and verification tokens fail.

**`trustedOrigins` is your CSRF defence**, and it must be explicit. It carries **both** Tauri origins from day one — `tauri://localhost` and `http://tauri.localhost` — because the scheme genuinely differs by platform, and shipping one produces an app that works for half your team. The value lives in `AUTH_TRUSTED_ORIGINS` and the same list drives the CORS allowlist ([24](24-web-app.md)); one origin list, two consumers. A wildcard here is not a shortcut; it is the vulnerability.

### Where the tenant and the surface come from

`PrincipalBuilder` is handed request headers and nothing else, and a `Principal` cannot be built without an organization. Both facts are resolved once, at sign-in, by the session-create hook and written onto the session row:

- **`activeOrganizationId`** — from `MembershipReader` (Step 16.3). Returning `false` aborts the session, so a user with no membership gets a failed sign-in rather than a principal with no tenant — which would read every tenant's rows, with nothing downstream positioned to notice.
- **`surface`** — `web` or `desktop`, derived from the request origin. Recorded rather than inferred later, because desktop sessions are longer-lived and have to be revocable on their own ([30](30-desktop-app.md)), and a user-agent string is not a durable answer to which is which.

Both are `input: false`. That is what stops a sign-up body from naming its own tenant or claiming a surface — the fields exist on the model, so without it they would be writable by whoever is registering.

### Three columns on `users` that Better Auth never heard of

`locale` is read on the first server render of every request ([20](20-content-package.md)), which is why it lives here rather than in a preferences table that would need a join before anything can be rendered. `timezone` is nullable. `deactivatedAt` exists because deactivation is a state and not a delete — the activity log points at that row forever, and a deactivated user keeps their rows while losing their capabilities.

---

## Step 16.3 — `BetterAuthSessionResolver` and `MembershipReader`

**`packages/auth/src/session/better-auth-session.resolver.ts`**

```ts
export class BetterAuthSessionResolver extends SessionResolver {
  public constructor(private readonly auth: AuthInstance) {
    super();
  }

  public override async resolve(headers: RequestHeaders): Promise<ResolvedSession | null> {
    const result = await this.auth.api.getSession({ headers: headers as Headers });
    if (!result?.session) return null;

    // Pinned by the session-create hook. A session that predates it — or one written
    // by hand — has none, and is treated as no session at all.
    const { activeOrganizationId } = result.session as { activeOrganizationId?: string };
    if (!activeOrganizationId) return null;

    return {
      organizationId: activeOrganizationId as OrganizationId,
      userId: result.session.userId as UserId,
      sessionId: result.session.id,
      expiresAt: new Date(result.session.expiresAt),
    };
  }
}
```

**This class is the only place in the repository that names Better Auth's session API.** Everything else depends on `SessionResolver` from `application`. Replacing the auth library means rewriting this file and nothing else — which is the same reason `packages/auth` is a package rather than living in `apps/web/src/server/`.

`getSession` handles cookie and bearer transparently; both arrive as headers.

**A missing `activeOrganizationId` returns `null`, never a default.** Guessing a tenant here is a cross-tenant read that raises no error and appears in no log. The only correct behaviour for a session that does not name its organization is to treat it as no session.

**The cast to `Headers` is the one place this package leans on something the port does not promise.** `RequestHeaders` is deliberately narrow — `application` declares `{ get() }` rather than naming a `Headers` it has no lib for ([12](12-application-package.md)) — but Better Auth reads cookies by iterating. Every caller passes a genuine `Headers` ([24](24-web-app.md), [25](25-worker-app.md)), so it holds; a hand-rolled stub with only `get` would typecheck and fail at runtime.

**`packages/auth/src/session/membership.reader.ts`**

```ts
export abstract class MembershipReader {
  // Null when the user holds no membership.
  public abstract activeOrganizationFor(userId: UserId): Promise<OrganizationId | null>;
}
```

Implemented in `infrastructure` as `PgMembershipReader`, ordered by creation so a user in two organizations lands in the same one every time rather than wherever the planner happened to look first.

> **Declared here rather than in `application`, and that is the same judgement `ApiKeyRepository` gets in Step 16.6.** It exists to populate an authentication artifact, and no use-case should learn that sessions have an organization column.
>
> The cost is that `infrastructure` cannot implement it nominally — `auth` already depends on `infrastructure`, so the arrow cannot point back — and the two are bound structurally in `Container` ([17](17-composition-container.md)). A signature drift fails composition's typecheck rather than this package's. That is a real trade, and the alternative is worse: a port in `application` describing a table `application` is not allowed to know exists.

---

## Step 16.4 — `CapabilityCache`

`PgCapabilityRepository.resolveFor()` is three queries across role permissions, goal memberships, and overrides. It runs on essentially every request. Fine at ten users, not at five hundred.

**`packages/auth/src/principal/capability.cache.ts`**

```ts
import type { CacheStore, CapabilityRepository } from "@loadbearing/application";
import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { CapabilitySet, type CapabilitySetDto } from "@loadbearing/permissions";

export class CapabilityCache {
  private static readonly PREFIX = "capability:user:";
  private static readonly TTL_SECONDS = 60;

  constructor(
    private readonly repository: CapabilityRepository,
    private readonly cache: CacheStore,
  ) {}

  public async forUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<CapabilitySet> {
    const key = `${CapabilityCache.PREFIX}${organizationId}:${userId}`;

    const cached = await this.cache.get<CapabilitySetDto>(key);
    if (cached) return CapabilitySet.from(cached);

    const resolved = await this.repository.resolveFor(organizationId, userId);
    await this.cache.set(key, resolved.toJSON(), CapabilityCache.TTL_SECONDS);
    return resolved;
  }

  // Call on every RBAC write. See the invalidation list below.
  public async invalidate(organizationId: OrganizationId, userId: UserId): Promise<void> {
    await this.cache.delete(`${CapabilityCache.PREFIX}${organizationId}:${userId}`);
  }

  // Role edits affect everyone holding it — cheaper to flush than to enumerate, and
  // the tenant in the key is what keeps that flush inside the organization.
  public async invalidateOrganization(organizationId: OrganizationId): Promise<void> {
    await this.cache.deletePrefix(`${CapabilityCache.PREFIX}${organizationId}:`);
  }
}
```

### Invalidation is part of the RBAC write path, not an optimization

Every one of these must evict:

| Event | Evict |
|---|---|
| Role's permissions changed | `invalidateOrganization(organizationId)` |
| Role deleted | `invalidateOrganization(organizationId)` |
| Membership's role changed | `invalidate(userId)` |
| Membership added or removed | `invalidate(userId)` |
| Goal member added or removed | `invalidate(userId)` |
| Permission override written or deleted | `invalidate(userId)` |
| User deactivated | `invalidate(userId)` |
| API key created or revoked | `invalidate(issuerId)` |

**Get this wrong in the stale direction and a revoked permission keeps working until the TTL expires.** That is a security bug, not a caching bug. Every one of these events is already written to the activity log, so the eviction hook has an obvious home next to that write — but *after* the transaction commits, not inside it: a flush issued while the old row is still committed lets a concurrent read cache the stale set again.

**The domain never names this class.** The use-cases take a `CapabilityInvalidator` port from `application/src/port/`, and `Container` binds `CapabilityCache` to it — `application` may not import `auth`, which is what makes the port the only way this call can exist in a use-case at all.

**The cache key carries the organization, and that is not decoration.** A key of `capability:user:<id>` means a user who belongs to two organizations gets whichever capability set was cached first — a cross-tenant privilege bug with a one-minute fuse and no error anywhere. The prefix scheme still supports `deletePrefix`, because the organization segment sits between the fixed prefix and the user id.

**This is the read path the whole system's throughput rests on.** At scale it is fronted by signed capability data in the session cookie and an in-process LRU, so most requests never reach Redis at all — Step 16.9 has the chain and the TTL ceiling. Build it as written first; the two tiers above it are the [Data and scale](../opinions/data-and-scale.md) §6 answer to a load test, not something to add speculatively.

**Sixty seconds, and no longer.** The TTL is a backstop for an invalidation you forgot, not the primary mechanism. Raising it to an hour because the cache hit rate looks better is trading a security window for a metric.

**`CapabilitySetDto` round-trips through JSON**, which is why this cache works at all — the same property that lets the browser reconstruct a `CapabilitySet` from an SSR payload ([08](08-permissions-package.md)).

---

## Step 16.5 — `PrincipalBuilder`

Every request, regardless of surface, resolves to the same `Principal`. This is the class that makes four auth mechanisms collapse into one authorization model.

```
request
  → credential detection   (x-api-key | cookie | bearer)
  → SessionResolver        → { userId } | null
  → CapabilityCache        → CapabilitySet   (Redis, else three DB queries)
  → Principal(userId, capabilities, kind)
  → use-case               → authorizer.assert(...)
```

**`packages/auth/src/principal/principal.builder.ts`**

```ts
import { Principal, type SessionResolver } from "@loadbearing/application";
import type { UserId } from "@loadbearing/contracts";
import type { ApiKeyResolver } from "../apikey/api-key.resolver.js";
import type { CapabilityCache } from "./capability.cache.js";

export class PrincipalBuilder {
  constructor(
    private readonly sessions: SessionResolver,
    private readonly apiKeys: ApiKeyResolver,
    private readonly capabilities: CapabilityCache,
  ) {}

  public async fromHeaders(headers: RequestHeaders): Promise<Principal | null> {
    const apiKey = headers.get("x-api-key");
    if (apiKey) return this.apiKeys.resolve(apiKey);

    const session = await this.sessions.resolve(headers);
    if (!session) return null;

    const caps = await this.capabilities.forUser(session.organizationId, session.userId);
    return new Principal(session.organizationId, session.userId, caps, "user");
  }
}
```

**The oRPC middleware calls this, never Better Auth directly** ([24](24-web-app.md)). That is what keeps the transport layer ignorant of the auth library, and it is why moving to NestJS later means rewriting a guard rather than rewriting authentication.

**API key is checked first.** A request carrying both a session cookie and an `x-api-key` header is an integration calling through a browser context, and the key is the more specific credential. Checking the session first would silently upgrade a scoped key to full user permissions.

---

## Step 16.6 — API keys

**`packages/infrastructure/src/pg/schema/api-key.schema.ts`**

```ts
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { UserId } from "@loadbearing/contracts";
import { users } from "./auth.schema.js";
import { organizations } from "./rbac.schema.js";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuerId: uuid("issuer_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // First 8 chars of the token — indexed lookup without storing the secret.
    prefix: text("prefix").notNull(),
    // sha256(token). The token itself is never stored, anywhere, ever.
    tokenHash: text("token_hash").notNull(),

    // Scopes at creation, already intersected with the issuer's capabilities.
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.tokenHash),
    index("api_keys_prefix_idx").on(t.prefix),
    index("api_keys_issuer_idx").on(t.organizationId, t.issuerId),
  ],
);
```

**`packages/auth/src/apikey/api-key.hasher.ts`**

> [!NOTE]
> **Minting is not in this file any more.** `ApiKeyRules` in `packages/application/src/apikey/`
> owns the token format and `mint()`, because issuing a key is a use-case and both layers depend on
> the same format — two copies drift into a key that authenticates against nothing. What is left
> here is what *authentication* needs: `hash`, `prefixOf`, `timingSafeEqual`.

```ts
export class ApiKeyHasher {
  private constructor() {}

  public static async hash(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  public static prefixOf(token: string): string {
    return token.slice(0, ApiKeyHasher.PREFIX_LENGTH);
  }

  public static timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
}
```

**`packages/auth/src/apikey/api-key.resolver.ts`**

```ts
import { Principal } from "@loadbearing/application";
import type { UserId } from "@loadbearing/contracts";
import { CapabilitySet, PermissionRegistry, type PermissionKey } from "@loadbearing/permissions";
import type { CapabilityCache } from "../principal/capability.cache.js";
import { ApiKeyHasher } from "./api-key.hasher.js";

export interface ApiKeyRecord {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly issuerId: UserId;
  readonly tokenHash: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

// In `packages/application/src/apikey/` — see the note below. `notBefore` is the
// throttle on a write that sits on the hottest read path in the system.
export abstract class ApiKeyRepository {
  public abstract findByPrefix(prefix: string): Promise<readonly ApiKeyRecord[]>;
  public abstract touch(id: ApiKeyId, at: Date, notBefore: Date): Promise<void>;
  // …plus listByOrganization, findById, create and revoke, for the settings page.
}

export class ApiKeyResolver {
  constructor(
    private readonly repository: ApiKeyRepository,
    private readonly capabilities: CapabilityCache,
  ) {}

  public async resolve(token: string): Promise<Principal | null> {
    const hash = await ApiKeyHasher.hash(token);
    const candidates = await this.repository.findByPrefix(ApiKeyHasher.prefixOf(token));

    const record = candidates.find((c) => ApiKeyHasher.timingSafeEqual(c.tokenHash, hash));
    if (!record) return null;

    const now = new Date();
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt <= now) return null;

    const registry = PermissionRegistry.instance;
    const scoped = record.scopes.filter((s): s is PermissionKey => registry.isKnown(s));

    const declared = CapabilitySet.from({
      wildcard: false,
      org: { grants: scoped, denies: [] },
      goals: {},
    });

    // Re-intersect with the issuer's LIVE capabilities on every request.
    const issuer = await this.capabilities.forUser(record.organizationId, record.issuerId);
    const effective = declared.intersect(issuer);

    await this.repository.touch(record.id, now);
    return Principal.apiKey(record.organizationId, record.issuerId, effective);
  }
}
```

### Why it is built this way

**Store `sha256(token)` with a short lookup prefix, never the token.** A database dump then contains no usable credentials. The prefix is what makes lookup an indexed query rather than a scan-and-compare over every key.

**Re-intersect with the issuer's live capabilities on every resolution**, not only at creation. This is the part that matters. If a key's scopes were frozen at creation, revoking the issuer's `finance.read.global` would leave every key they ever created still able to read finance — and nobody would notice, because the key still works. Re-intersecting means revoking a person's permission immediately narrows every key they issued. That closes the most common way an RBAC model gets quietly defeated.

**Timing-safe comparison** even though the prefix already narrowed the candidate set. It costs nothing and removes a class of question you would otherwise have to answer in a security review.

**`ApiKeyRepository` was declared here as an abstract class**, on the argument that an API key is an authentication artifact rather than a domain entity and nothing in `application` should know keys exist. **That argument did not survive the feature.** The moment the product grew `/settings/api-keys`, issuing a key became a domain operation gated on `apikey.manage`, with a scope check, an audit row and a `UnitOfWork` — so the port lives in `packages/application/src/apikey/` and `auth` imports it from there, as it already imports `SessionResolver`.

What survived is better than the original rule: the *shapes* are split rather than the ports. `ApiKeyRecord` carries `tokenHash` and is what authentication reads; `ApiKeySummary` is what a list renders and has no hash field at all, so a digest cannot reach the wire through a careless DTO mapping.

---

## Step 16.7 — The four surfaces

**Web** — httpOnly cookie, `sameSite: "lax"`, `secure` in production. JavaScript cannot read the token, so XSS cannot exfiltrate a session.

**Desktop (Tauri)** — the bearer plugin. The token lives in the OS keychain on the Rust side; the webview asks for it through a Tauri command and passes it via `BearerAuthStrategy` ([18](18-api-client-package.md)). The token is never written to `localStorage`, where any injected script could read it.

**Client portal** — the same `users` table and the same login. A portal user is a user whose role resolves to a deliberately tiny capability set. There is no second auth system, which is why the portal cannot develop its own vulnerabilities.

**Integrations** — an API key resolving to a `Principal` with `kind: "api_key"`.

Four surfaces, one `Principal`, one `Authorizer.assert()`.

---

## Step 16.8 — Security checklist

- **Email verification required** before a session grants anything beyond a stub. Otherwise anyone can create an account naming a colleague's address.
- **2FA available, enforceable per role.** Enforce it for anyone holding `rbac.role.manage`; optional otherwise.
- **Revoke all sessions on password change.** `revokeSessionsOnPasswordReset: true` above. This is the difference between "changed my password" and "actually locked them out."
- **`trustedOrigins` explicit.** No wildcards, and **both** Tauri origins present — the scheme differs by platform, so one of them is half a deployment.
- **Auth events go to the audit trail** — sign-in, sign-out, password change, 2FA enrolment, session revocation, API-key creation and revocation.
- **Never log tokens, session IDs, or key material.** Redact at the logger, not at each call site — a rule enforced in one place holds.
- **Invite-only registration** for internal roles. Open sign-up creates unaffiliated users the RBAC model has no place for.
- **Pin Better Auth and watch its advisories.** The catalog floor sits above CVE-2025-61928 for a reason ([03](03-workspace-and-catalogs.md)), and every upgrade ends with `auth:tables` diffed against the schema — a field the runtime gained and the schema did not is a column that silently reads as null.

---

## Step 16.9 — Session lifetime, and the revocation chain

**Multi-organisation was the other open question here, and it is now decided.** `organization_id` is on every domain table from the first migration, and it is the sharding key ([13](13-infrastructure-postgres.md), [Data and scale](../opinions/data-and-scale.md) §4.1). The reasoning is unchanged — retrofitting a tenant column across two dozen feature modules is a genuinely large migration discovered when the first customer asks — but it is no longer conditional on whether you expect a second tenant. It costs a column now and it is the one thing on this page that cannot be added cheaply later.

What that leaves for this step is session lifetime, which interacts with something the scale work made concrete: **there are three caches between a permission change and a request seeing it.**

```
signed cookie cache   ← 60s max
  → in-process LRU    ← 10s, per app instance
    → Redis           ← 60s TTL
      → Postgres      ← the truth
```

**The revocation window is the longest TTL in that chain, not the shortest cache.** Every tier has to be bounded by the number you are willing to answer for when someone says "I removed their access, why does it still work?" Sixty seconds is that number here. Explicit invalidation on a grant change is the mechanism; the TTLs are the backstop for an invalidation somebody forgot.

An in-process LRU is the tier that surprises people, because a Redis `DEL` cannot reach it — twenty app instances hold twenty copies. Keep its TTL short enough that correctness never depends on invalidating it, which is why it is seconds rather than minutes.

**Two values, and they are answered — as environment variables, not literals.** The defaults below ship in `.env.example`; a staging box and production are not obliged to agree, which is the whole reason they are not constants in `AuthFactory`.

| Value | Variable | Default | Note |
| --- | --- | --- | --- |
| Web session lifetime | `AUTH_SESSION_MAX_AGE_SECONDS` | 7 days | |
| Slides on activity? | — | Yes | `updateAge` is a quarter of the lifetime, so a session in daily use is never interrupted while an abandoned one still expires on schedule. A sliding window and a short cookie-cache TTL interact — the cache delays revocation regardless |
| Revocation window | `AUTH_COOKIE_CACHE_MAX_AGE_SECONDS` | 60s | Capped at 60 in the env schema ([24](24-web-app.md)), because the pressure to raise it always arrives as a performance argument |

**A second surface will want a longer-lived token than a web session, and that needs independent
revocation** — "sign out all devices" has to reach a machine that may be offline. That is what the
`surface` column on `sessions` is for (Step 16.2): every session records where it was opened from,
so revoking one class is `DELETE FROM sessions WHERE user_id = $1 AND surface = 'desktop'` against
`sessions_user_surface_idx` — not a scan, and not a guess made from a user-agent string months after
the fact. Today every row says `web`, and the column costs a byte.

**Deciding this at the same time as the lifetime is the point**, and it is the exception
[Simplicity](../opinions/simplicity.md) names: a seam earns its place early when the retrofit is
spread rather than local. Adding `surface` to a table with a year of sessions in it, and then
backfilling a value nobody recorded, is not a migration anyone wants to write. The mechanism is
cheap now and expensive on the afternoon somebody loses a laptop.

**A bearer-token client would have no cookie**, so the first tier of the chain above does not exist
for it ([30](30-desktop-app.md)) — it pays a full capability resolution on every cache miss, and the
in-process LRU is the only thing absorbing it. Worth knowing before the load test: the two surfaces
have genuinely different cost profiles per request.

---

## Step 16.10 — The barrel

**`packages/auth/src/index.ts`**

```ts
import { ServerOnly } from "./import.js";

ServerOnly.assert("@loadbearing/auth");

export { ApiKeyHasher, ApiKeyResolver } from "./apikey/index.js";
export type { AuthConfig } from "./auth.config.js";
export { AuthFactory, type AuthInstance } from "./auth.factory.js";
export { CapabilityCache, PrincipalBuilder } from "./principal/index.js";
export { BetterAuthSessionResolver, MembershipReader } from "./session/index.js";
```

The barrel grows with the slices below it — `MembershipEnroller`, `InvitationClaimer`,
`OrganizationFounder` and `InvitationClaimingEnroller` from `session/`, and the plugin from
`plugin/` — each named explicitly, because `export *` would make the public surface an accident.

**`tables/` is not exported, and neither is anything under it.** `tsup` builds `src/index.ts` alone, so the schema-inspection script never reaches `dist/` — the same arrangement `infrastructure` gives `migrate.ts` and `seed.ts` ([15](15-infrastructure-package.md)).

**`auth.config.ts` contributes only a type, so its line is `export type { … }`, not `export { type … }`.** Biome's `useExportType` rewrites the second form into the first automatically when every specifier is a type; run `biome check --write` and stop thinking about it.

---

## Step 16.11 — Enrolment: how a new user acquires a membership

**No session is ever issued to a user with no membership.** `BetterAuthSessionResolver` refuses one,
which is fail-closed and correct — and it means sign-up is only half a flow until something inserts
into `memberships`. `MembershipEnroller` is that something, and it is the write half of the pair
`MembershipReader` reads.

**`packages/auth/src/session/membership.enroller.ts`**

```ts
export abstract class MembershipEnroller {
  // Null is not an error: registration switched off returns it on every sign-up, and
  // the session is then refused. Fail-closed is the whole point.
  public abstract enrol(userId: UserId): Promise<OrganizationId | null>;
}
```

**Three implementations, and `AUTH_ENROLMENT_MODE` picks one** — the container is where the choice is
made, exactly like every other adapter:

| Mode | Enroller | What a new user gets |
|---|---|---|
| `personal` | `PgPersonalOrganizationEnroller` | An organization of their own, owned by them, with the same four system roles `pnpm db:seed` creates |
| `bootstrap` | `PgBootstrapMembershipEnroller` | Membership of the one organization `BOOTSTRAP_ORGANIZATION_SLUG` names — first in as `owner`, everyone after as `member` |
| `invite` | `NullMembershipEnroller` | Nothing. Their first sign-in is refused |

**`personal` is the default and the only mode that works against an empty database.** `bootstrap` is
right for a demo or a single-tenant install and wrong for anything reachable from the internet — the
sign-up form then hands out membership of your tenant. `invite` is the production posture: an
invitation is the only door.

**The mode is not the whole answer, because an invited address never gets what the mode would give
it.** `InvitationClaimingEnroller` wraps whichever enroller the mode picked:

```ts
public async enrol(userId: UserId): Promise<OrganizationId | null> {
  return (await this.claimer.claimPending(userId)) ?? this.inner.enrol(userId);
}
```

**Decorating rather than branching is what keeps this one rule instead of three.** Written as a
condition inside each enroller, "an invitation wins" would be stated three times and could disagree
with itself; here the mode's enroller never learns invitations exist. Adding a fourth mode inherits
the behaviour for free.

> [!IMPORTANT]
> **Claims match on the verified address**, which is why invitations need
> `AUTH_REQUIRE_EMAIL_VERIFICATION` on. Matching an unverified one lets anyone type a colleague's
> address at sign-up and walk into their organization.

**Enrolment runs from `session.create.before`, not `user.create.after`.** Better Auth queues
`create.after` hooks until the whole sign-up endpoint has finished — which is *after* the session
hook has already refused for want of a membership. The symptom is a sign-up that appears to succeed
and a sign-in that never does, with the membership row present in the database the whole time.

**`bootstrap` takes a `pg_advisory_xact_lock`** so two simultaneous first sign-ups cannot both read
"no owner yet" and both become one.

---

## Step 16.12 — The organization plugin: switch, create, accept

Three actions do not fit the oRPC router, and the reason is worth stating rather than working around.

**They are identity-gated, not permission-gated.** Switching to an organization you are a member of
is not a permission any role grants — `memberships.isActive(user, org)` *is* the whole authorization,
and there is no key that could express it. Creating an organization is the same: a person with no
memberships at all may do it.

**And only an endpoint holding Better Auth's own `ctx` can call `setSessionCookie`.** Without that,
`session.cookieCache` keeps answering for the old tenant for up to sixty seconds after a switch — so
the very next RPC reads the wrong organization's rows, and it looks like a cache bug rather than a
missing call.

**`packages/auth/src/plugin/organization.plugin.ts`** declares three endpoints under Better Auth's
own base path:

| Endpoint | Authorization |
|---|---|
| `POST /organization/switch` | `memberships.isActive(user, organizationId)` — one indexed lookup, and the whole check |
| `POST /organization/create` | A session, **and** fewer than `AUTH_MAX_OWNED_ORGANIZATIONS` already owned. The caller becomes `owner`, through the same `OrganizationFounder` the personal enroller uses |
| `POST /invitation/accept` | The token, claimed against the verified address |

**The cap on create is a second limit, not a stricter rate limit.** Five a minute is three hundred an
hour, and each call seeds four roles and every permission the registry defines; a scripted client
left running overnight fills three tables without ever doing anything the rate limit considers
abusive. `ownedCount` counts memberships joined to `roles` on `key = 'owner'` — ownership is holding
the role, which is the definition that survives a transfer — and it is a `count(*)` rather than the
length of `organizationsFor()`, because that read is itself capped and would make the check pass
forever at its ceiling. See
[`auth/docs/reference/organization-plugin.md`](../../packages/auth/docs/reference/organization-plugin.md).

All three end in the same private `rebind`, and **the order inside it is the load-bearing part**:

```ts
await ctx.context.internalAdapter.updateSession(token, { activeOrganizationId });
await ctx.context.internalAdapter.updateUser(user.id, { lastActiveOrganizationId: organizationId });
await setSessionCookie(ctx, { session: updated, user });
```

Row first, then where the next sign-in lands, then the cookie cache. Writing the cookie first and the
row second leaves a window where a crash produces a cookie pointing at a tenant the session table
does not agree with — and the cookie is what every subsequent request believes.

**`lastActiveOrganizationId` is honoured only while the membership still exists**, so removing
someone from an organization needs no cleanup pass over this column.

---

## ✅ Gate

- `pnpm --filter @loadbearing/auth run auth:tables` runs, and every field it prints has a matching property in `packages/infrastructure/src/pg/schema/auth.schema.ts` under Better Auth's own name.
- `pnpm db:migrate` created `users`, `sessions`, `accounts`, `verifications`, `two_factors`, and `api_keys`.
- `sessions` has both `active_organization_id` and `surface`, each `NOT NULL`.
- `api_keys` carries `organization_id`, and `api_keys_issuer_idx` covers the `issuer_id` foreign key.
- The foreign keys from `memberships`, `goal_members`, and `permission_overrides` to `users(id)` exist, and every `user_id` column is `uuid`.
- `grep -rn "better-auth" packages --include=*.ts` matches only `packages/auth/` and (later) `packages/api-client/src/auth/`.
- With `AUTH_ENROLMENT_MODE=personal`, a fresh sign-up reaches the app and owns an organization named after them, against a database `pnpm db:seed` has never touched.
- With `AUTH_ENROLMENT_MODE=invite`, the same sign-up is refused at sign-in — and an address holding a pending invitation is not.
- Switching organizations and **immediately** issuing an RPC answers for the new tenant, not the old one. Inside sixty seconds, this is the assertion that catches a missing `setSessionCookie`.

```bash
grep -rn 'text("user_id")\|text("actor_id")\|text("issuer_id")' packages/infrastructure/src/pg
```

Returns nothing. A `text` user reference left anywhere means the `generateId` configuration in Step 16.2 was skipped, and the foreign keys above silently did not apply.

Do not proceed until this passes.

---

[← `@loadbearing/infrastructure`](15-infrastructure-package.md) · [`@loadbearing/composition` →](17-composition-container.md)
