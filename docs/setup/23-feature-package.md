# 23 · `@loadbearing/feature`

> Components that fetch and mutate. The auth screens, the message provider, the session guard — and every feature screen that follows.

**Delivers:** Sign-in, two-factor, session gating, and i18n binding, all mountable under any routing shell.

**Prerequisite:** [22 · `@loadbearing/ui`](22-ui-package.md)

---

## The two bans that make this package work

**`feature` may not import `@loadbearing/api-client`.** Every read goes through a defined query in `@loadbearing/query`. Without this rule, someone under deadline pressure writes `await client.task.list()` directly inside a component; it works fine, and now there is an uncached read that no invalidation will ever touch. Banning the import at the lint level makes it unwriteable rather than discouraged.

**`feature` may not import `@tanstack/react-router`.** Navigation arrives as an `onNavigate` prop or an `href`. That is what lets the Tauri app mount these components under a different routing shell.

Both are enforced by a `files`-scoped block in the root ESLint config ([05](05-lint-and-format.md), Step 5.3) — **not** by Biome. There is no config file in this package.

```
packages/feature/src/
├── index.ts                       ← "use client" on line 1
├── import.ts                      ← every external symbol. The two bans, made visible
├── i18n/
│   ├── index.ts
│   └── message.context.tsx        → MessageProvider, useMessages
├── auth/
│   ├── index.ts
│   ├── sign-in.form.tsx           → SignInForm
│   ├── two-factor.form.tsx        → TwoFactorForm
│   └── session.context.tsx        → SessionProvider, useSession, useCapabilities
└── rbac/
    ├── index.ts
    ├── permission-matrix.tsx      → PermissionMatrix
    └── effective-permissions.inspector.tsx
```

---

> [!IMPORTANT]
> **This package's barrel opens with `"use client"`.** It is React components and hooks end to end,
> and Next's App Router treats every module as a Server Component until told otherwise — without the
> directive, a Next page importing from here fails the build. A Vite SPA and TanStack Start ignore
> it. The rule, and the list of packages that must **not** carry it, is in
> [06](06-package-anatomy.md#use-client--the-boundary-that-makes-next-work).

## Step 23.1 — The message provider

The React binding for `@loadbearing/content`'s `Translator`. It lives here, not in `content`, because `content` must stay React-free for the worker.

**`packages/feature/src/i18n/message.context.tsx`**

```tsx
import type {
  ClientNamespace,
  MessageStore,
  NamespaceKeys,
  ShellNamespace,
  Translator,
} from "@loadbearing/content";
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const MessageContext = createContext<Translator | null>(null);

// Keys a component may use: its own namespace, plus the always-loaded shell.
type ScopedKey<N extends ClientNamespace> = NamespaceKeys[N] | NamespaceKeys[ShellNamespace];

export function MessageProvider({
  messages,
  children,
}: {
  messages: MessageStore;
  children: ReactNode;
}) {
  const subscribe = useCallback((onChange: () => void) => messages.subscribe(onChange), [messages]);
  const read = useCallback(() => messages.translator, [messages]);
  const translator = useSyncExternalStore(subscribe, read, read);

  return <MessageContext.Provider value={translator}>{children}</MessageContext.Provider>;
}

export function useMessages<N extends ClientNamespace>(namespace: N) {
  const translator = useContext(MessageContext);
  if (!translator) throw new Error("useMessages must be used inside a MessageProvider.");

  const t = useCallback(
    (key: ScopedKey<N>, params?: Readonly<Record<string, string | number>>) =>
      translator.t(key, params),
    [translator],
  );

  return { t, locale: translator.locale };
}
```

> [!NOTE]
> **`MessageStore` is item 7 of [20](20-content-package.md) Step 20.10, deferred there "until
> `ensure()` has a caller".** This is that caller — `MessageProvider` subscribes to it, and
> [24](24-web-app.md)'s route loader calls `ensure()`. Build it now, in `content`, not here: it is
> React-free and the worker uses the same class.

**The snapshot is built server-side and inlined into the SSR payload** ([24](24-web-app.md)
Step 24.10), so the correct locale is present in the first rendered byte. Fetching translations
client-side means either a flash of English or a blocking request before anything renders.

**A component declares the namespace it reads from**, and gets a `t` that will not accept
anything else:

```tsx
const { t } = useMessages("auth");
t("auth.signIn");       // ✓
t("action.cancel");     // ✓  shell — always loaded
t("nav.roles");         // ✗  compile error
```

> [!IMPORTANT]
> **`N` is inferred once, from a single argument position, and that is what makes it work.**
> `useMessages("auth")` fixes `N` before any key is written, so the returned `t` has a concrete
> parameter type. The two-argument shape that looks equivalent does **not** constrain anything:
>
> ```ts
> declare function t<N extends string>(ns: N, key: Extract<MessageKey, `${N}.${string}`>): string;
> t("auth", "error.forbidden");   // compiles
> ```
>
> There the key position is also an inference site, so `N` widens until both arguments fit.
> `NamespaceKeys[N]` — an indexed access into a mapped type — is not an inference site. That is
> why `Translator.t` keeps a flat `MessageKey` and **all** narrowing happens here, in the one
> place that knows the namespace statically.

**The shell namespaces are always in scope**, which is why `t("action.cancel")` and
`t("error.forbidden")` work from an auth screen without declaring `common`. The type says
exactly what the runtime guarantees: every `ContentSource` puts `common` and `error` in every
snapshot ([20](20-content-package.md)), so they belong in every component's key union.

**`email` cannot be named here at all.** `N extends ClientNamespace`, and `email` is a
`ServerNamespace`. The ESLint ban in [05](05-lint-and-format.md) Step 5.3 is a second lock on a
door the type system has already closed.

**`useSyncExternalStore`, because navigation adds namespaces after the provider mounted.** The
store is subscribed once, at the provider; `useMessages` stays a plain context read.
`MessageStore.translator` returns a stable identity until `ensure()` genuinely adds something —
if it minted a new `Translator` per call, this would re-render forever.

---

## Step 23.2 — The session context

Session and capabilities are needed by nearly every component, and threading them through props for twelve levels is not a real option.

**`packages/feature/src/auth/session.context.tsx`**

```tsx
import { CapabilitySet, type CapabilitySetDto } from "@loadbearing/permissions";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

interface SessionValue {
  readonly user: SessionUser | null;
  readonly capabilities: CapabilitySet;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  user,
  capabilities,
  children,
}: {
  user: SessionUser | null;
  capabilities: CapabilitySetDto;
  children: ReactNode;
}) {
  const value = useMemo<SessionValue>(
    () => ({ user, capabilities: CapabilitySet.from(capabilities) }),
    [user, capabilities],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider.");
  return value;
}

export function useCapabilities(): CapabilitySet {
  return useSession().capabilities;
}
```

**The provider takes a `CapabilitySetDto` and reconstructs the class.** The DTO is what crosses the SSR boundary as JSON; `CapabilitySet.from()` on the client produces an object whose `can()` is byte-identical to the server's. This is the round-trip property from [08](08-permissions-package.md) doing its actual job.

**`useMemo` on the reconstruction** so a re-render does not rebuild the internal `Set`s and invalidate every downstream memo.

**`capabilities` defaults to nothing, never to permissive.** A signed-out user gets `CapabilitySet.empty()` from the app, and `empty()` denies everything. There is no "loading" state that grants access.

---

## Step 23.3 — The enforcement surfaces this package owns

`<Can>` is the one this package ships, and it hides an affordance that would fail. An earlier draft
also had a `SessionGuard` component here, taking `onUnauthenticated` and `onForbidden` callbacks so
that `feature` could redirect without naming the router. It was deleted: `RouteGuard` in the route
loader does the same job one layer up, and does it **before the page renders at all** rather than
after a component has mounted and called back. Two guards meant two places to state the same rule.

**This is the third of four enforcement surfaces**, and the weakest one. The order of authority:

1. `Authorizer.assert()` in the use-case — the real gate ([12](12-application-package.md))
2. `principalMiddleware` in the oRPC handler — defence in depth ([24](24-web-app.md))
3. `RouteGuard` in the route loader — stops the page rendering at all ([24](24-web-app.md))
4. `<Can>` in this package — hides an affordance that would fail

Removing a permission from a role must remove the nav item **and** return `FORBIDDEN`. Both, every time. If only the UI hides, you have security theatre; if only the API rejects, you have a UI full of buttons that produce errors.

---

## Step 23.4 — `SignInForm`

**`packages/feature/src/auth/sign-in.form.tsx`**

```tsx
import {
  type AuthClient,
  Button,
  ErrorNormalizer,
  Field,
  type FormEvent,
  Input,
  SessionMutations,
  useState,
} from "../import.js";
import { useMessages } from "../i18n/index.js";

export interface SignInFormProps {
  readonly auth: AuthClient;
  readonly onSuccess: () => void;
  readonly onNeedsTwoFactor?: () => void;
}

export function SignInForm({ auth, onSuccess, onNeedsTwoFactor }: SignInFormProps) {
  const { t } = useMessages("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = SessionMutations.useSignIn(auth);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate(
      { email, password },
      {
        onSuccess: () => onSuccess(),
        onError: (error) => {
          if (ErrorNormalizer.normalize(error).code === "TWO_FACTOR_REQUIRED") {
            onNeedsTwoFactor?.();
          }
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("auth.email")} htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>

      <Field label={t("auth.password")} htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>

      {signIn.isError ? (
        <p role="alert" className="ui-field__error">
          {t("auth.signInFailed")}
        </p>
      ) : null}

      <Button type="submit" disabled={signIn.isPending}>
        {signIn.isPending ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
  );
}
```

> [!IMPORTANT]
> **This listing needs three things earlier steps do not deliver.** `Button`, `Field` and `Input`
> are imported from `@loadbearing/ui` and appear nowhere in [22](22-ui-package.md) — not in its tree,
> not in its barrel. They are simple enough to write by hand under that document's rule 4, and they
> go there rather than here because they carry no domain knowledge. `ErrorNormalizer` is used and
> never imported; it comes from `@loadbearing/errors`, which this package therefore depends on.

### Four things worth copying from this

**`AuthClient` arrives as a prop, not from a module import.** Same reason `createQueryClient` is a factory: the instance differs per environment, and a module singleton in an SSR bundle is shared across requests.

**Branch on the code, never on the message.** `error.message` is the code and nothing else ([09](09-errors-package.md)) — but even if it carried prose, matching on it would break the moment someone rewords the copy, and it would already be broken in every locale but English, because the sentence a user sees comes from `content`.

**The error message is generic.** `t("auth.signInFailed")` — never "no account with that email" or "incorrect password". Distinguishing them is an account-enumeration oracle: an attacker learns which addresses are registered without needing a password. It is a small copy decision with a real security consequence.

**`autoComplete` on both fields.** `email` and `current-password` are what password managers key on. Omitting them is a real usability cost for a class of users who will not report it.

**Every string comes from `useMessages`.** No literals in this package either. `feature` is where copy meets components, and it meets it through the catalog.

---

## Step 23.4b — The three components this document names and does not specify

`TwoFactorForm`, `PermissionMatrix` and `EffectivePermissionsInspector` are in the tree above and in
the barrel below, with no listing anywhere in this document. What they need is worth stating, because
two of them turn out to need nothing at all:

**`TwoFactorForm`** is the second leg of a sign-in that answered `TWO_FACTOR_REQUIRED`, and it needs
one method that [18](18-api-client-package.md) does not define: `AuthClient.verifyTwoFactor(code)`,
wrapping Better Auth's `client.twoFactor.verifyTotp`. Add it there, throwing on a bad code like every
other method on that class, so the form has one error path rather than two.

> [!CAUTION]
> **`AuthClient`'s private field cannot be typed `ReturnType<typeof createAuthClient>`.** That is the
> **unconfigured** client; the two-factor plugin widens the instance, and annotating with the
> unconfigured type erases the widening, so `client.twoFactor` does not exist and the file will not
> compile. Extract a non-exported `const createClient = (config) => createAuthClient({…})` and type
> the field `ReturnType<typeof createClient>`. This is the same trap `AuthFactory.create` documents
> on the server side ([16](16-auth-package.md)) — infer from the options, read the type back out.

**`PermissionMatrix` and `EffectivePermissionsInspector` need no query at all**, which is the
interesting part. The permission axis is `PermissionRegistry.instance` — already in the bundle — and
the answer axis is `CapabilitySet.can()`, which is already in the session context. So the inspector
takes nothing but an optional `goalId`, and the matrix takes its *subjects* as a prop:

```ts
export interface MatrixSubject {
  readonly id: string;
  readonly label: string;
  readonly capabilities: CapabilitySet;
}
```

That is the one deliberate departure from the fetch-here pattern in Step 23.5, and it is worth
understanding rather than copying blindly: the rows are the **catalog**, which is static, and the
columns are whatever the caller is comparing — roles on an admin screen, two users in a support tool.
A component that fetched its own columns could only ever do one of those.

**Both render a word, not a glyph.** `✓` announces as "check mark", which is not an answer, so the
cells read `t("state.allowed")` / `t("state.denied")` — two keys this adds to `content`'s `common`
namespace — and carry `data-allowed` for a design pass to hang an icon on. Biome's
`useAriaPropsSupportedByRole` rejects the obvious shortcut of an `aria-label` on a bare `<span>`.

---

## Step 23.5 — What a feature screen looks like

The shape every feature module follows:

```tsx
// packages/feature/src/task/task-board.tsx
import {
  Can,
  DataTable,
  EmptyState,
  TaskQueries,
  useApiClient,
  useAppQuery,
} from "../import.js";
import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";

export interface TaskBoardProps {
  readonly goalId: string;
  readonly onOpenTask: (taskId: string) => void;
}

export function TaskBoard({ goalId, onOpenTask }: TaskBoardProps) {
  const client = useApiClient();
  const caps = useCapabilities();
  const { t } = useMessages("task");

  const { data, isPending } = useAppQuery(TaskQueries.list(client, { goalId }));

  if (isPending) return <DataTable.Skeleton rows={5} />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon="check" title={t("task.empty.title")} />;
  }

  return (
    <>
      <Can permission="task.create" goalId={goalId} capabilities={caps}>
        <CreateTaskButton goalId={goalId} />
      </Can>
      <DataTable rows={data.items} onRowClick={(row) => onOpenTask(row.id)} />
    </>
  );
}
```

Read through it: data comes from `query`, presentation from `ui`, copy from `content`, permission from the session context, navigation from a prop. It imports no router, no `api-client`, and no server code. That is the whole pattern, and every feature module repeats it.

> [!NOTE]
> **`useAppQuery`, not `useQuery` — and that is the whole reason it exists.** An earlier revision of
> this listing imported `useQuery` from the cache library directly, which contradicted
> [21](21-query-package.md)'s gate: no shipped module outside `packages/query` may name it. The
> wrapper is three lines and a pass-through ([21](21-query-package.md) Step 21.4b), and it keeps the
> invariant whole rather than exempting this package from it.
>
> Test files are a different matter: a harness mounting a real `QueryClientProvider` is building the
> environment a component runs in, not bypassing `query`, and `import.ts` governs `src/` rather than
> `tests/` ([Opinions · Imports](../opinions/imports.md)). The gate is scoped to `packages/*/src`
> accordingly.

---

## Step 23.6 — Testing

`feature` components are tested with fakes, never against a running server:

> [!NOTE]
> **`BundledContentSource` is item 8 of [20](20-content-package.md) Step 20.10 and lands with
> [30](30-desktop-app.md).** Until it does, `StaticContentSource` gives the same snapshot
> asynchronously — `new MessageStore(content, await content.messages("en", namespaces))` — and the
> harness becomes `async`. Nothing else about it changes.
>
> This package also needs the same three test files [22](22-ui-package.md) introduced:
> `vitest.config.ts` with `environment: "jsdom"`, and a `vitest.setup.ts` running
> `afterEach(cleanup)` — **not optional with `globals: false`**.

```tsx
function renderWithFakes(ui: ReactNode, caps: CapabilitySetDto) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const content = new BundledContentSource();
  const messages = new MessageStore(content, content.snapshotSync("en"));

  return render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={fakeApiClient}>
        <MessageProvider messages={messages}>
          <SessionProvider user={testUser} capabilities={caps}>
            {ui}
          </SessionProvider>
        </MessageProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}
```

The test worth writing first: **render the same component with two different `CapabilitySetDto` fixtures and assert the create button appears in one and not the other.** That single test exercises the round-trip property, the `<Can>` gate, and the session context all at once — and it fails loudly if the client and server ever stop agreeing about permissions.

---

## Step 23.7 — The barrel

**`packages/feature/src/index.ts`**

```tsx
"use client";

export {
  type SessionGuardProps,
  SessionProvider,
  type SessionProviderProps,
  type SessionUser,
  SignInForm,
  type SignInFormProps,
  TwoFactorForm,
  type TwoFactorFormProps,
  useCapabilities,
  useSession,
} from "./auth/index.js";
export { MessageProvider, type MessageProviderProps, useMessages } from "./i18n/index.js";
export {
  EffectivePermissionsInspector,
  type EffectivePermissionsInspectorProps,
  type MatrixSubject,
  PermissionMatrix,
  type PermissionMatrixProps,
} from "./rbac/index.js";
```

**`SessionValue` is not on the list**, even though `useSession()` returns it. Callers get the type through inference, and the interface stays free to gain a field without that being a public API change — the private layer a star export cannot give you ([Opinions · Imports](../opinions/imports.md)).

---

## ✅ Gate

```bash
grep -rn "@loadbearing/api-client" packages/feature/src
```

Returns nothing **except** `import type { AuthClient }` in `src/import.ts`, and the separator
comment above it — every `import.ts` in the repository groups its specifiers under a header naming
the source ([Opinions · Imports](../opinions/imports.md)), and this gate matches comments. A
type-only import is permitted because it creates no runtime dependency.

> [!IMPORTANT]
> **This is why the ban lives in ESLint rather than Biome.** Biome's `noRestrictedImports` flags `import type` exactly like a value import and has no type-import exemption — verified against 2.5.7 — so a Biome-side ban would error on `SignInForm`'s own import. `@typescript-eslint/no-restricted-imports` supports `allowTypeImports: true`, and the core rule must be `"off"` alongside it, since it has no such option. See [05](05-lint-and-format.md) Step 5.3.

```bash
grep -rn "@tanstack/react-router" packages/feature/src
```

Returns nothing.

- No string literal appears in rendered output — every user-visible string comes from `useMessages`.
- The namespace narrowing is real, not decorative:

  ```ts
  const { t } = useMessages("auth");
  t("auth.signIn");       // ✓
  t("action.cancel");     // ✓  shell
  t("error.forbidden");   // ✓  shell
  t("nav.roles");         // ✗  compile error — not declared, not shell
  ```

  **That last line failing is the whole feature.** If it compiles, the mapped type has been
  replaced with a template-literal `Extract` somewhere and the constraint is doing nothing.
- The `packages/feature/src/**` block from [05](05-lint-and-format.md) Step 5.3 is in place and errors on a **value** import of either package, while allowing `import type`.
- **Adding `import { Database } from "@loadbearing/infrastructure"` to a component in this package is a Biome error**, from the single server-only override. If it is not, some later `overrides` block has replaced that rule's `paths` instead of restating them — see the caution in [05](05-lint-and-format.md) Step 5.2.

Do not proceed until this passes.

---

[← `@loadbearing/ui`](22-ui-package.md) · [`apps/web` →](24-web-app.md)
