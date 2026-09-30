---
title: "@loadbearing/feature"
description: Components that fetch and mutate — the auth screens, the message provider, the session guard. Mountable under any routing shell, because navigation arrives as a prop.
---

# `@loadbearing/feature`

Where data, presentation, copy and permissions meet. Two bans define it, and both are unwriteable
rather than discouraged.

**No `@loadbearing/api-client`.** Every read goes through a defined query in
[`query`](../../query/docs/index.md). Without the ban, someone under deadline writes
`await client.task.list()` inside a component; it works, and now there is an uncached read that no
invalidation will ever touch.

**No router.** Navigation arrives as an `onNavigate` prop or an `href`. That is what lets the Tauri
shell mount these components under a different routing shell.

| | |
| --- | --- |
| **Package** | `@loadbearing/feature` (private, never published) |
| **Entrypoint** | `src/index.ts` — opens with `"use client"` |
| **Depends on** | `content`, `contracts`, `errors`, `permissions`, `query`, `ui` |
| **Type-only** | `api-client` — a `devDependency`, because `AuthClient` arrives as a prop |
| **Peers** | `react`, `react-dom` |

```
packages/feature/src/
├── index.ts                                → "use client" on line 1
├── import.ts                               → the two bans, made visible
├── i18n/message.context.tsx                → MessageProvider, useMessages
├── auth/
│   ├── session.context.tsx                 → SessionProvider, useSession, useCapabilities
│   ├── session.guard.tsx                   → SessionGuard
│   ├── sign-in.form.tsx                    → SignInForm
│   ├── sign-up.form.tsx                    → SignUpForm
│   ├── sign-out.button.tsx                 → SignOutButton
│   ├── social-sign-in.tsx                  → SocialSignIn
│   ├── forgot-password.form.tsx            → ForgotPasswordForm
│   ├── reset-password.form.tsx             → ResetPasswordForm
│   ├── password-pair.tsx                   → the shared confirm-and-strength control
│   ├── two-factor.form.tsx                 → TwoFactorForm
│   └── verify-email.notice.tsx             → VerifyEmailNotice
├── account/
│   ├── profile.form.tsx                    → ProfileForm
│   ├── change-email.form.tsx               → ChangeEmailForm
│   ├── change-password.form.tsx            → ChangePasswordForm
│   ├── two-factor.panel.tsx                → TwoFactorPanel
│   ├── two-factor.setup.tsx                → TwoFactorSetup
│   ├── active-session.list.tsx             → ActiveSessionList
│   └── linked-account.list.tsx             → LinkedAccountList
├── organization/
│   ├── create-organization.form.tsx        → CreateOrganizationForm
│   ├── organization-switcher.tsx           → OrganizationSwitcher
│   └── invitation-accept.tsx               → InvitationAccept, InvitationPreview
├── member/
│   ├── member-list.tsx                     → MemberList
│   ├── invite-member.form.tsx              → InviteMemberForm
│   └── invitation-list.tsx                 → InvitationList
├── platform/
│   ├── platform-status.panel.tsx           → PlatformStatusPanel
│   ├── projection-gaps.panel.tsx           → ProjectionGapsPanel
│   ├── projection-policy.form.tsx          → ProjectionPolicyForm
│   ├── projection-switch.panel.tsx         → ProjectionSwitchPanel
│   ├── retention-policy.form.tsx           → RetentionPolicyForm
│   ├── retention-preview.notice.tsx        → RetentionPreviewNotice
│   ├── restore-partition.panel.tsx         → RestorePartitionPanel
│   ├── tenant-retention.form.tsx           → TenantRetentionForm
│   └── tenant-storage.list.tsx             → TenantStorageList
└── rbac/
    ├── permission-matrix.tsx               → PermissionMatrix, MatrixSubject
    ├── role-matrix.tsx                     → RoleMatrix
    ├── role-list.tsx                       → RoleList
    ├── create-role.form.tsx                → CreateRoleForm
    ├── use-role-failure.ts                 → useRoleFailure
    └── effective-permissions.inspector.tsx → EffectivePermissionsInspector
```

Both bans live in the **root ESLint config**, not Biome, and that is not a preference: Biome's
`noRestrictedImports` flags `import type` identically to a value import and has no exemption for one,
so a Biome-side ban would error on `SignInForm`'s own `AuthClient` import.
`@typescript-eslint/no-restricted-imports` has `allowTypeImports: true`, and the core rule must be
`"off"` beside it since it has no such option.

Both are verified the way this repository verifies every rule — by writing the violation and watching
it fail. A value import of `api-client` errors; so does `import { Database } from "@loadbearing/infrastructure"`,
from the single server-only Biome override.

## `useMessages` narrows to one namespace, and the shape is what makes it work

```tsx
const { t } = useMessages("auth");
t("auth.signIn");       // ✓
t("action.cancel");     // ✓  shell — always loaded
t("nav.roles");         // ✗  compile error
```

**`N` is inferred from a single argument position, before any key is written.** The two-argument
shape that looks equivalent constrains nothing — there the key position is *also* an inference site,
so `N` widens until both arguments fit. `NamespaceKeys[N]`, an indexed access into a mapped type, is
not an inference site. That is why `Translator.t` keeps a flat `MessageKey` and all narrowing happens
here, in the one place that knows the namespace statically.

**The shell is in the union because the runtime guarantees it.** Every `ContentSource` puts `common`
and `error` in every snapshot ([`content`](../../content/docs/index.md)), so `t("action.cancel")`
works from an auth screen without declaring `common`. And `email` cannot be named at all —
`N extends ClientNamespace`, and `email` is a `ServerNamespace`.

**`useSyncExternalStore`, because navigation adds namespaces after the provider mounted.** The store
is subscribed once, at the provider; `useMessages` stays a plain context read. `MessageStore` returns
a stable translator identity until `ensure()` genuinely adds something — a new object per call would
re-render forever.

## The session context reconstructs the class from a DTO

```tsx
<SessionProvider user={user} capabilities={dto}>
```

The DTO is what crosses the SSR boundary as JSON; `CapabilitySet.from()` on the client produces an
object whose `can()` is the same `can()` the server ran. **That is the round-trip property from
[`permissions`](../../permissions/docs/index.md) doing its actual job**, and it is what the first
test asserts.

`useMemo` on the reconstruction, so a re-render does not rebuild the internal `Set`s and invalidate
every downstream memo. And capabilities default to nothing, never to permissive — a signed-out user
gets `CapabilitySet.empty()`, which denies everything. There is no loading state that grants access.

## `SessionGuard` is the weakest of four surfaces

| | Surface | Where |
| --- | --- | --- |
| 1 | `Authorizer.assert()` in the use-case — **the real gate** | [`application`](../../application/docs/index.md) |
| 2 | `principalMiddleware` in the oRPC handler | `apps/web` |
| 3 | the route guard — stops the page rendering | `apps/web` |
| 4 | `<Can>`, `<Widget>` and `SessionGuard` — hide affordances that would fail | here and `ui` |

Removing a permission from a role must remove the nav item **and** return `FORBIDDEN`. Both, every
time. UI-only is security theatre; API-only is a screen full of buttons that error.

**The redirect is a callback, not a `<Navigate>`.** That is the router ban in practice: `apps/web`
passes `() => navigate({ to: "/sign-in" })`, the desktop shell passes its own. The component knows
*that* it should redirect, never *how* — and a spec asserts the callback fires and the children do
not render.

## A card on the dashboard is the registry's, never the page's

`DashboardZone` asks `WidgetRegistry` which widgets `dashboard.main` holds and which of them this
session may see, then renders only those. A hidden card is **not mounted**, so its query is never
issued — hiding is not `display: none`. `prefetchDashboard` runs the same visibility for the route's
loader, so nothing is fetched ahead of a render that would not use it.

`DASHBOARD_WIDGETS`, the map from key to component, is typed total over the zone and is **not
exported**: nothing outside can render a card without asking the registry first. Its titles come
from `WIDGET_COPY` in `content`, total over every widget, so a widget without a title does not
compile. `<Widget>` is the inline form, for a unit outside any zone; its permission is the
registry's, which is why it takes no permission prop.

## Two things worth copying from `SignInForm`

**Branch on the code, never the message.** `error.message` *is* the code
([`errors`](../../errors/docs/index.md)) — but even if it carried prose, matching on it would break
the moment someone reworded the copy, and would already be broken in every locale but English.

**The failure message is generic.** `t("auth.signInFailed")` — never "no account with that email" or
"incorrect password". Distinguishing them is an account-enumeration oracle: an attacker learns which
addresses are registered without needing a password. A small copy decision with a real security
consequence.

## Three forms set a password, and they ask the same two questions once

`PasswordPair` renders the new-password and confirm fields together with both rules on them: the
floor, and equality. It takes an `idPrefix` rather than fixed ids, so two on one page stay distinct,
and `passwordPairReady(password, confirmation)` is the submit guard beside it — sign-up, reset and
change each derived that boolean their own way.

**The floor is `Password.MIN_LENGTH` from `contracts`, and `AuthFactory` reads the same constant.**
It was the literal `12` in four places. A form advertising a shorter floor than the server's turns a
rejection into an unexplained failure; a longer one refuses a password the server would have taken.
One authority, and both sides import it.

`DateFormat.day` in [`ui`](../../ui/docs/index.md) is the same move at a smaller scale: two lists
declared the same `toISOString().slice(0, 10)` helper, and the reason it is ISO rather than
locale-formatted — the server renders it and the browser hydrates it — is worth stating once.

## Every list renders four states, in one order

Pending → error → empty → the list, and the order is the whole point: `data` is `undefined` until
the first answer, so any component that reads `data ?? []` and asks "is it empty?" first tells every
reader their account has no linked providers and their organization no members, for as long as the
request takes. A failed request answers the same way, which is worse — "there are no members" is the
one thing a members page must not say when it does not know.

```tsx
if (query.isPending) return <EmptyState title={shell.t("state.loading")} />;
if (query.isError) return <Callout tone="danger">{shell.t("state.error")}</Callout>;
if (rows.length === 0) return <EmptyState title={t("member.empty")} />;
```

`shell` is `useMessages("common")` beside the screen's own namespace — the states are shared copy,
and the namespace is what keeps a typo a compile error. `MemberList` renders `DataTable.Skeleton`
rather than a loading sentence, because it knows its own shape.

**`ActiveSessionList` has a fifth state and it is per row.** `ActiveSession.current` says which
session the tab is holding — the endpoint flags none, and the cookie carrying the token is httpOnly,
so `AccountClient.listSessions` is the only place the comparison can happen. The current row gets
the badge and **no** Revoke: signing yourself out of the page you are reading is what "Sign out on
all devices" is for. Before that flag existed, the badge was rendered once after the list, attached
to no device at all.

## `PermissionMatrix` fetches nothing, and that is the point

The permission axis is `PermissionRegistry.instance` — already in the bundle — and the answer axis is
`CapabilitySet.can()`. So `PermissionMatrix` takes its **subjects** as a prop rather than reading
them: rows are the catalog, which is static, and columns are whatever the caller is comparing —
roles on an admin screen, two users in a support tool. A component that fetched its own columns
could only ever do one of those.

`EffectivePermissionsInspector` splits on the same line. With no `userId` it answers from the
session context with no round trip; with one it reads `RoleQueries.effective`, because *someone
else's* resolved set is a question only the server can answer.

`editable` is per subject rather than per matrix, because a page showing four roles where three are
seeded needs one editable column and three that are not. A checkbox appears only where `onToggle`
is given **and** that subject allows it, so the read-only case is honest rather than a control that
silently does nothing.

**Both render a word, not a glyph.** `✓` announces as "check mark", which is not an answer. Cells
read `t("state.allowed")` / `t("state.denied")` — two keys this package added to `content`'s `common`
namespace — and carry `data-allowed` for a design pass to hang an icon on. Biome's
`useAriaPropsSupportedByRole` rejects the shortcut of an `aria-label` on a bare `<span>`, correctly.

## Testing

```bash
pnpm --filter @loadbearing/feature test
```

**The test doc 23 names as the one worth writing first** is in `tests/rbac/`: render the same
component with two different `CapabilitySetDto` fixtures and assert the answers differ. That single
test exercises the DTO round-trip, the session context and `CapabilitySet.can` at once — and fails
loudly the day the client and server stop agreeing about permissions.

The harness lives in `tests/support/render-with-fakes.tsx` and is **async**, because doc 23 builds it
on `BundledContentSource.snapshotSync` — a [30](../../../docs/setup/30-desktop-app.md) item that does
not exist yet. `StaticContentSource` gives the same snapshot asynchronously and nothing else changes.

`vitest.setup.ts` runs `afterEach(cleanup)`, which is **not optional** with `globals: false` — see
[`ui`](../../ui/docs/index.md) for the failure it prevents.

## One thing this package does not have

**No product slice.** Everything here is identity, membership and authorization — the surfaces every
product needs before it has a product. Nothing yet reads a domain procedure, so the twelve-step
checklist in doc 23 §23.5 is still the unwalked path rather than a description of what shipped.

**No copy of its own for a failure.** `useErrorMessage` normalises what a query or mutation threw and
renders it through [`ErrorCopy`](../../content/docs/reference/error-copy.md), so the sentence a user
reads is keyed to the code the server sent. Nine components rendered `state.error` — one generic
sentence — against an envelope that already said which failure it was.

`useTranslator` exists for that hook alone: `useMessages(namespace)` narrows keys to one namespace,
and `ErrorCopy` picks its own shell key from the code, so there is nothing to scope.

**No cache-library import.** A slice reads through
[`useAppQuery`](../../query/docs/index.md) — a three-line pass-through in `query` that exists so this
package never names `@tanstack/*`. The invariant is asserted over `packages/*/src`: `import.ts`
governs the shipped surface, and a test harness mounting a real `QueryClientProvider` is building the
environment a component runs in rather than bypassing `query`.
