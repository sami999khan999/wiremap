# Visibility

Three independent reasons something is missing from a screen in the lite kit. Each can only
narrow the one above it, and each has a different owner.

| Mechanism | Owner | Reach | What the API says |
|---|---|---|---|
| **Flag** | engineering, temporary | the deployment, or a list of orgs | `NOT_FOUND` |
| **Entitlement** | platform admin | one org — a plan plus adjustments | `FORBIDDEN` |
| **Permission** | org admin | a role, or one user | `FORBIDDEN` |

- **Entitlement is a mask, not a step.** It narrows the `CapabilitySet` on the server, so `<Can>`,
  the nav, `RouteGuard` and `Authorizer.assert` obey a plan without knowing it exists. **Grants
  are filtered, never deleted** — an upgrade restores the org admin's roles at once. `core` and
  `platform`-scope keys are never masked.
- **A flag check throws `NOT_FOUND`, and the error carries no flag key.** `error.toJSON()` reaches
  the browser. Client-gating flag names are in the bundle anyway: **a flag is not a secret.**
- **A new flag is a fragment file plus one spread** in `permissions`' `flag/` barrel. Every flag
  declares an owner and an expiry date.
- **`<Can>` gates an affordance.** It hides a button, never a whole screen's route — the route has
  `RouteGuard`.
- **Never lazy-load by permission.** It hides nothing and adds a waterfall to the allowed path.
- **Hiding is not revoking.** The API, a bookmark and the nav still work; the server's
  `Authorizer.assert` is the gate, and nothing on the client is.
- **A platform admin is not a tenant owner.** `wildcard` is never set in production, and a
  platform admin gets no powers inside a tenant.

**A doc's access link adds no mechanism.** A page or space linked to a module, permission, flag
or plan is resolved through the three above and hides as `NOT_FOUND` — see
`packages/application/docs/reference/doc.md`.

**The fourth mechanism — widget preference, with zones — is not in lite.** A per-user "hide this
card" is not a flag, an entitlement or a permission, and must not be faked with one. It comes back
whole from [`docs/scale/`](../../scale/index.md), with its resolution order and its ten rules.

---

**The argument.**
[`docs/opinions/visibility.md`](../../opinions/visibility.md) — the mechanisms, the resolution
order, why entitlement is a mask, and the rules for a widget once it is ported.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
