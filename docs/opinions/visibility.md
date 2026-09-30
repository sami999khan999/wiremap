---
title: Visibility
description: Four independent reasons something is missing from a screen — a flag, an entitlement, a permission, a widget preference — the order they resolve in, and the one answer to "why is it gone".
---

# Visibility

> [!NOTE]
> **Lite kit.** Lite ships three of the four mechanisms — flag, entitlement, permission. Widget
> preferences and zones are not built, so everything below about widgets is the design to port,
> not code to look for. It comes back from [`docs/scale/`](../scale/index.md); until then the
> dashboard is a static page.

A card that is not on the dashboard could be missing for four different reasons. Engineering has
not finished it. The org's plan does not include it. The person's role does not grant it. Or
somebody hid it. Each of those has a different owner and a different fix. When they are one
mechanism, "why is it gone" has no answer anyone can give without reading code.

So there are four mechanisms, and each one can only narrow the one above it.

| Mechanism | Owner | Reach | Lifetime | What the API says |
|---|---|---|---|---|
| **Flag** | engineering | the deployment, or a list of orgs | temporary — deleted after rollout | `NOT_FOUND` |
| **Entitlement** | platform admin | one org | as long as the org exists | `FORBIDDEN` |
| **Permission** | org admin | a role, or one user | ongoing | `FORBIDDEN` |
| **Widget preference** | a user, or the org admin | one user, or the whole org | persists | nothing — it is cosmetic |

---

## The order, broadest cause first

A widget resolves **flag → permission → admin preference → user preference**, and it stops at the
first one that hides it. The answer is always the most fundamental reason. A user who hid a card
their role no longer grants is told `denied`, not `hidden-by-user`. Restoring the card would change
nothing, so the preference is the wrong thing to report.

The answer is one of six words, the `WidgetVisibility` union: `visible`, `hidden-by-flag`,
`denied`, `hidden-by-admin`, `hidden-by-user`, `unregistered`. The last one is a preference row
naming a widget the code no longer declares. It is a stale row, not an error.

## Entitlement is a mask, not a step

Entitlement is not in that chain, and the reason is where it runs. It narrows the org's
`CapabilitySet` on the server, before anything asks a question of it. By the time a widget asks
"may this person see this", the answer already has the plan in it. `<Can>`, the nav, `RouteGuard`
and `Authorizer.assert` all obey a plan without any of them knowing plans exist.

That is also why **grants are filtered, never deleted**. The rows on a role are the org admin's
data. A downgrade that deleted them would make the upgrade a reconstruction job. A mask over them
makes the upgrade instant, and the admin's configuration comes back exactly as they left it.

Two sets of keys are never subject to it: `core`-module keys, which everyone holds, and
`platform`-scope keys, which no tenant plan can reach.

## `NOT_FOUND` for a flag, `FORBIDDEN` for the rest

A flag that is off means the thing does not exist yet, for this org. `FORBIDDEN` would tell a
caller the endpoint is there and they lack the key, which is a claim about a feature nobody
announced. So a flag check throws `NOT_FOUND`, and **the error carries no flag key**:
`ErrorInterceptor` sends `error.toJSON()` to the browser, and a server-only flag's name must not
reach it.

The names of *client-gating* flags — the ones some widget names — are in the bundle anyway. **A
flag is the wrong tool for a secret.** It controls when something ships, not who may know it
exists.

---

## The rules for a widget

Six from the design this model came from, and four this repository adds.

1. **A widget is the smallest unit with an independent reason to be absent.** A card is a widget.
   The button inside it is not, because it cannot be missing for any reason the card is not.
2. **`policy` defaults to `required`.** A widget is dismissible only when someone decided it
   should be. A card that can vanish by default is a support ticket waiting for a reason.
3. **The permission lives in the registry, never in props.** Only `goalId` comes from the call
   site. A permission passed as a prop is a permission each call site can get wrong, and the
   inspector could not say what a widget needs without rendering it.
4. **Registered is not resolved.** Every widget is declared statically, in a fragment. Whether it
   shows is computed per request. A registration that depends on runtime state is a widget no
   check can see.
5. **A widget preference is cosmetic.** Hiding a card writes a row, not an audit entry, and changes
   nothing anyone can do.
6. **Per-user denies narrow and are permanent. Per-user grants widen and must expire.** A deny left
   in place is safe. A grant left in place is access nobody reviews, so it carries a reason and an
   expiry: thirty days by default and ninety at most.
7. **`<Can>` gates an affordance inside a visible unit; `<Widget>` gates a unit.** Neither wraps the
   other. A zone takes an `items` array rather than children, so `<Can>` as a zone's direct child
   cannot be written.
8. **Inline widgets are required.** Preferences are loaded by the route that owns a zone, not by
   the session, and an inline widget has no zone. Making one dismissible means moving preferences
   onto the session payload, which is a routed read on every document request.
9. **Never lazy-load by permission.** The bundle is not a secret, so a permission-keyed `lazy()`
   hides nothing. What it does do is add a network waterfall to the one path the user is allowed
   to take. Route splitting is the router's job already.
10. **Hiding is not revoking.** A hidden card's procedure still answers, a bookmarked URL still
    opens, and the nav still reaches its module. So the nav is `required` and never hideable: it
    is the last path to every capability, and a hidden card must never remove the only way in.

## Why these names

The mount point is a **zone**, never a surface. The reasoning, and the grammar of flag, widget and
zone keys, is on [Vocabulary](vocabulary.md). The four places a permission is checked are
[enforcement surfaces](../../apps/web/docs/reference/enforcement-surfaces.md); `<Widget>` is a
second form of the fourth, and like `<Can>` it is not the gate. Why a platform admin is not a
tenant owner is
[platform scope](../../packages/permissions/docs/reference/platform-scope.md).

## Where these rules are enforced

| Rule | Enforced by |
|---|---|
| A zone's component map names exactly its zone's widgets | the type: `satisfies Record<ZoneWidgetKey<…>, …>` |
| Every inline widget is placed by a literal key | `check-architecture.mjs` §30 |
| No flag outlives its expiry, and none goes unread | `check-architecture.mjs` §31 |
| Every dismissible widget's module has a nav gate | a spec over `WidgetRegistry` and `GATES` |
| No `lazy()` in `feature` or `apps/web` | ESLint `no-restricted-syntax` |
| The permission is never a prop | the type: `<Widget>` has no `permission` prop |
| `<Can>` is never a zone's direct child | the type: `<Zone>` takes `items`, not children |
| Rules 1 and 4 | Review |

Every row but the last is built. Rules 1 and 4 are judgements about a design, and no check can
make them.
