# 21 · `@loadbearing/query`

> The single TanStack owner. Query keys, query and mutation options, the provider, and the client factory.

**Delivers:** `QueryKeys`, `createQueryClient()`, `ApiClientProvider`, `useAppMutation`, and session state living in the same cache as everything else.

**Prerequisite:** [20 · `@loadbearing/content`](20-content-package.md)

---

## One package imports `@tanstack/*`. Nothing else in the repo may.

`api-client` stays React-free so scripts, tests, and non-React hosts can load it. `feature` reads through this package and is forbidden from importing `api-client` directly. `ui` knows nothing about data at all. **And this package must not import `@tanstack/react-router`** — routing stays in `apps/web`, which is what lets the Tauri app reuse everything above it.

```
packages/query/src/
├── index.ts                      ← "use client" on line 1
├── import.ts                   ← every external symbol
├── key/
│   ├── index.ts
│   └── query-key.ts            → QueryKeys
├── runtime/
│   ├── index.ts
│   ├── query-client.ts         → createQueryClient()
│   ├── api-client.context.tsx  → ApiClientProvider, useApiClient
│   ├── use-app-mutation.ts     → useAppMutation
│   └── use-app-query.ts        → useAppQuery
└── session/                    ── one subject folder per slice
    ├── index.ts
    ├── session.queries.ts      → SessionQueries
    └── session.mutations.ts    → SessionMutations
```

Two role folders and one subject folder — the same split `contracts` has, and for the same reason:
there is exactly one `QueryKeys` and one client factory, and one queries/mutations pair *per slice*
([Folders](../opinions/folders.md), which lists `query` as subject-organised).

**The barrel is `index.ts`.** It was `index.tsx` here, in `ui` and in `feature` — matching the
scaffolded `exports` map and the `tsup` entry ([06](06-package-anatomy.md)) — but none of the three
contains JSX, and the extension is what a reader uses to tell a component file from a re-export.
The `exports` map and the `tsup` entry name the barrel either way.

---

> [!IMPORTANT]
> **This package's barrel opens with `"use client"`.** It is React components and hooks end to end,
> and Next's App Router treats every module as a Server Component until told otherwise — without the
> directive, a Next page importing from here fails the build. A Vite SPA and TanStack Start ignore
> it. The rule, and the list of packages that must **not** carry it, is in
> [06](06-package-anatomy.md#use-client--the-boundary-that-makes-next-work).

## Step 21.1 — `QueryKeys`

**`packages/query/src/key/query-key.ts`**

```ts
export class QueryKeys {
  private constructor() {}

  public static readonly session = ["session"] as const;

  // Illustrative until the slice exists: `AppContract` is `{}` today, so there is no
  // `task` procedure to mirror. Add the block with the slice, not before.
  public static readonly task = {
    all: () => ["task"] as const,
    list: (params: { goalId: string; status?: string }) => ["task", "list", params] as const,
    detail: (taskId: string) => ["task", "detail", taskId] as const,
  };

  public static readonly rbac = {
    all: () => ["rbac"] as const,
    roles: () => ["rbac", "role", "list"] as const,
    effective: (userId: string) => ["rbac", "effective", userId] as const,
  };
}
```

**Every key mirrors its procedure path, with parameters last.** `contract.task.list` → `["task", "list", params]`. Given a procedure, you can write its key without looking anything up — the same derivability property the file-naming convention has.

**Keys are never hand-written at a call site.** Centralising them is what makes invalidation trustworthy: when task reactivation starts also invalidating capacity and KPI panels, you edit one method rather than grepping the codebase for `invalidateQueries`.

**`all()` exists on every namespace** so a broad invalidation is `queryClient.invalidateQueries({ queryKey: QueryKeys.task.all() })`. TanStack matches by prefix, so that one call catches every list and detail below it.

**Parameters go in an object, not spread as positional members.** `["task", "list", { goalId, status }]` rather than `["task", "list", goalId, status]`. Adding a filter later then does not shift every key and invalidate the entire namespace on deploy.

---

## Step 21.2 — `createQueryClient()`

**`packages/query/src/runtime/query-client.ts`**

```ts
import { type ApiClient, ERROR_CATALOG, ErrorNormalizer, QueryClient } from "../import.js";

export interface QueryClientOptions {
  readonly transport: ApiClient;
  readonly staleTimeMs?: number;
}

export interface QueryRuntime {
  readonly queryClient: QueryClient;
  readonly apiClient: ApiClient;
}

export function createQueryClient(options: QueryClientOptions): QueryRuntime {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: options.staleTimeMs ?? 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          // Retryability is a fact about the code, declared once in the catalog.
          const normalized = ErrorNormalizer.normalize(error);
          if (!ERROR_CATALOG[normalized.code].retryable) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  return { queryClient, apiClient: options.transport };
}
```

### `createQueryClient` is a factory, never a module-scope instance

This is not stylistic.

| Entry point | Lifetime | Why |
|---|---|---|
| `apps/web` SSR | **one per request** | A shared server-side instance serves user A's cached data to user B. Under this permission model that is a cross-tenant leak, not a caching bug. |
| `apps/web` browser | one singleton | Normal client behaviour |
| Tauri webview | one singleton | Same as browser — there is no SSR, so no per-request concern |

A module-scope `new QueryClient()` inside a server bundle is shared across every concurrent request. It will work perfectly in development, where there is one user.

One definition, three call sites:

```ts
// apps/web/src/router.tsx — browser
// `Endpoint.rpc`, not `Env.apiUrl`. `router.tsx` is isomorphic, and importing the env
// schema here is what put `DATABASE_URL` in the client bundle ([24](24-web-app.md) 24.2).
const { queryClient, apiClient } = createQueryClient({
  transport: ApiClient.overHttp(Endpoint.rpc, new CookieAuthStrategy()),
});

// apps/web SSR — same factory, in-process transport, no network
const { queryClient, apiClient } = createQueryClient({
  transport: ApiClient.inProcess(createServerRpcClient(request)),
});
```

**`createQueryClient` takes a constructed `ApiClient`, not a base URL.** That is what lets the server hand it an in-process transport and the browser hand it an HTTP one. Everything downstream is identical.

**`retry: false` on `FORBIDDEN`.** Retrying a permission failure twice with backoff turns an instant "you cannot do that" into a three-second wait for the same answer, and it triples the load from a client stuck in a bad state.

**It is the catalog that decides, not this file.** `ERROR_CATALOG[code].retryable` is declared once in [09](09-errors-package.md) and read here — which is why `@loadbearing/errors` is a dependency of this package. `ErrorNormalizer.normalize` runs first, so a library error that is not an `AppError` becomes `INTERNAL` and gets an answer from the catalog rather than a default. Both are worth pulling out into a spec: the predicate is reachable as `queryClient.getDefaultOptions().queries.retry`.

**`refetchOnWindowFocus: false`.** The default is a reasonable choice for a dashboard someone leaves open all day and a poor one for an app where every refetch is an authenticated round trip carrying a capability resolution. Turn it on per-query where freshness genuinely matters.

**`createQueryClient` is an exported function, which the OOP rule would normally reject** — hence this package using the `react` config. It is a factory in the React idiom, and wrapping it in a class to satisfy a lint rule would be cargo cult.

---

## Step 21.3 — The provider

**`packages/query/src/runtime/api-client.context.tsx`**

```tsx
import { type ApiClient, createContext, type ReactNode, useContext } from "../import.js";

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  readonly client: ApiClient;
  readonly children: ReactNode;
}

export function ApiClientProvider({ client, children }: ApiClientProviderProps): ReactNode {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used inside an ApiClientProvider.");
  }
  return client;
}
```

Context rather than a module singleton, for the same reason `createQueryClient` is a factory: the SSR instance and the browser instance are different objects with different transports.

---

## Step 21.4 — `useAppMutation`

**`packages/query/src/runtime/use-app-mutation.ts`**

```ts
import { type UseMutationOptions, useMutation, useQueryClient } from "../import.js";

export interface AppMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, Error, TVariables>, "onSuccess"> {
  // Keys invalidated after a successful mutation. Declared, never imperative.
  readonly invalidates?: readonly (readonly unknown[])[];
  readonly onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
}

export function useAppMutation<TData, TVariables>(
  options: AppMutationOptions<TData, TVariables>,
) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    ...options,
    onSuccess: async (data, variables) => {
      await Promise.all(
        (options.invalidates ?? []).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
      );
      await options.onSuccess?.(data, variables);
    },
  });
}
```

**Invalidation is declared, not written imperatively at each call site.** A mutation says *what it affects*; the hook does the invalidating. That means the "what does reactivating a task affect" question has one answer in one place, and updating it when a new panel starts depending on task state is a one-line edit.

---

## Step 21.4b — `useAppQuery`

**`packages/query/src/runtime/use-app-query.ts`**

```ts
import { type QueryKey, useQuery, type UseQueryOptions, type UseQueryResult } from "../import.js";

export function useAppQuery<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  return useQuery(options);
}
```

A pass-through, and that is the entire point. `useAppMutation` earns its wrapper by making
invalidation declarative; this one earns its wrapper by **existing** — it is what lets
`packages/feature` read through a defined query without naming the cache library, which is the
invariant the gate at the bottom of this document asserts.

Without it, the first feature slice imports `useQuery` directly and that gate starts failing — the
listing in [23](23-feature-package.md) Step 23.5 originally did exactly that.

> [!IMPORTANT]
> **There is nothing else in this function, and there must not be.** All four generics are inferred
> from the single argument, so `useAppQuery(TaskQueries.list(client, params))` types its `data`
> exactly as `useQuery` would. Adding a defaulted parameter — a retry policy, a `staleTime`, an
> options merge — moves the inference site and every call site quietly becomes `unknown`. Per-query
> defaults belong in the `queryOptions` factory; global ones belong in `createQueryClient`.
>
> A type-level spec pins this: the wrapper's parameter still accepts what `queryOptions()` produces,
> and its result still narrows to that query's data.

---

## Step 21.5 — Session state

Session is the piece of state that gates everything else, so it lives in the same cache as everything else. This is why [18](18-api-client-package.md) wraps Better Auth's *vanilla* client rather than using `better-auth/react`.

> [!NOTE]
> **There is no `SessionQueries`, and that is a decision rather than an omission.** An earlier draft
> cached `auth.session()` under `QueryKeys.session`, which put the session in two places: the cache
> and `SessionStore`, which rides the SSR payload ([24](24-web-app.md)). Two copies of the answer
> that gates every other read is one copy too many — the store owns it, resolves it server-side, and
> is what `RouteGuard` reads. `SessionMutations` stays, because signing in and out is a *write*.

**`packages/query/src/session/session.mutations.ts`**

```ts
import type { AuthClient } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class SessionMutations {
  private constructor() {}

  public static useSignIn(auth: AuthClient) {
    return useAppMutation<void, { email: string; password: string }>({
      mutationFn: ({ email, password }) => auth.signIn(email, password),
      invalidates: [QueryKeys.session],
    });
  }

  public static useSignOut(auth: AuthClient, onDone?: () => void) {
    return useAppMutation<void, void>({
      mutationFn: () => auth.signOut(),
      onSuccess: onDone,
    });
  }
}
```

**Sign-out clears the entire cache, not just the session key.** Invalidating only `["session"]` leaves every other user's-eye-view query sitting in memory, and the next person to sign in on that machine sees a flash of the previous user's data before refetch completes. The caller wires this in `apps/web`:

```ts
const signOut = SessionMutations.useSignOut(auth, () => {
  queryClient.clear();
  navigate({ to: "/sign-in" });
});
```

`queryClient.clear()` belongs at the call site rather than inside the mutation because it is a lifecycle decision, and the desktop app may want to preserve an offline cache across sign-out.

**A class holding static hook factories is fine here.** The hook rules apply to the call site — `SessionMutations.useSignIn(auth)` is called unconditionally at the top of a component, which is all React requires.

---

## Step 21.6 — What a feature slice looks like

For each contract namespace, two files:

```ts
// packages/query/src/task/task.queries.ts
import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@loadbearing/api-client";
import { QueryKeys } from "../query-key.js";

export class TaskQueries {
  private constructor() {}

  public static list(client: ApiClient, params: { goalId: string; status?: string }) {
    return queryOptions({
      queryKey: QueryKeys.task.list(params),
      queryFn: () => client.task.list(params),
    });
  }
}
```

```ts
// packages/query/src/task/task.mutations.ts
export class TaskMutations {
  private constructor() {}

  public static useReactivate(client: ApiClient, goalId: string) {
    return useAppMutation<TaskDto, ReactivateTaskInput>({
      mutationFn: (input) => client.task.reactivate(input),
      invalidates: [QueryKeys.task.all(), QueryKeys.rbac.all()],
    });
  }
}
```

**`queryOptions` rather than a bare `useQuery` wrapper.** It is a plain object, so a route loader can prefetch with `queryClient.ensureQueryData(TaskQueries.list(client, params))` and the component can call `useQuery(TaskQueries.list(client, params))` — same definition, same key, guaranteed cache hit.

---

## Step 21.7 — The barrel

**`packages/query/src/index.ts`**

```tsx
"use client";

export { QueryKeys } from "./key/index.js";
export {
  ApiClientProvider,
  type ApiClientProviderProps,
  type AppMutationOptions,
  createQueryClient,
  type QueryClientOptions,
  type QueryRuntime,
  useApiClient,
  useAppMutation,
  useAppQuery,
} from "./runtime/index.js";
export { SessionMutations, SessionQueries } from "./session/index.js";
```

A new slice adds one line here — `export { TaskMutations, TaskQueries } from "./task/index.js";` — and that line is the eleventh step of the checklist in [27](27-verification-and-first-feature.md) being visible in a diff.

---

## What a backend swap costs here

Keys and options never name a transport, so all of it is `ApiClient`-internal:

| Scenario | Changes in `packages/query/` |
|---|---|
| TanStack Start + oRPC (today) | — |
| NestJS + oRPC | nothing — `ApiClient` swaps its link |
| NestJS + plain REST | nothing — `ApiClient` gets a REST transport |
| `apps/worker` | does not import it — calls use-cases in-process |
| Tauri desktop | imports it unchanged |
| CLI or script | does not import it — uses `api-client` directly |

**SSR router integration stays in `apps/web`.** `routerWithQueryClient` needs `@tanstack/react-router`, which this package is forbidden to import. So `query` exports the factory and the app wires it to the router. That asymmetry is deliberate: routing is the one thing the desktop shell replaces.

---

## ✅ Gate

```bash
grep -rn "@tanstack" packages/*/src | grep -v "packages/query"
```

Returns nothing.

> [!NOTE]
> **The gate scopes to `src/`, deliberately.** `import.ts` governs the shipped surface, not `tests/`
> ([Opinions · Imports](../opinions/imports.md)) — a spec imports its harness directly, the same way
> it imports `vitest`. `packages/feature`'s test harness mounts a real `QueryClientProvider`, which
> is building the environment a component runs in rather than bypassing this package. Scoping the
> grep to `packages/*/src` is what makes the rule say what it means: **no shipped module outside this
> package names the cache library.**

```bash
grep -rn "@tanstack/react-router" packages/query/src
```

Returns nothing.

> [!WARNING]
> **That gate greps comments too.** The natural `import.ts` note explaining *why* the router is absent
> contains the exact specifier and fails the gate describing it. Say "the router package from the same
> vendor" instead. Docs [18](18-api-client-package.md) and [20](20-content-package.md) have gates with
> the same shape and the same trap.

- `packages/query/package.json` has `react` as a peer, not a dependency.
- `createQueryClient` is called nowhere at module scope, and
  `grep -rn "new QueryClient" packages apps` returns **exactly one** hit — inside the factory. That
  grep is the regression check for the request-scoped leak; the spec asserting two calls return two
  instances would still pass if a module singleton were reintroduced beside it.
- `head -1 packages/query/dist/index.js` is `"use client";`. Worth checking rather than assuming —
  esbuild has historically dropped top-level directives ([06](06-package-anatomy.md)).

Do not proceed until this passes.

---

[← `@loadbearing/content`](20-content-package.md) · [`@loadbearing/ui` →](22-ui-package.md)
