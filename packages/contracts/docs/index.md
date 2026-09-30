---
title: "@loadbearing/contracts"
description: Branded identifiers, the one list envelope, the merged oRPC contract, and the procedure→permission map — the shapes every runtime agrees on.
---

# `@loadbearing/contracts`

Everything that crosses a boundary is described here, once. A shape declared in this package is the
same shape the server validates, the browser form checks, the worker parses off a queue, and the
desktop app's offline queue rejects before it ever enqueues a mutation.

The package is **isomorphic and I/O-free**: Zod schemas, entity behaviour, and oRPC contract
definitions. No handler, no database, no transport. That is what lets a rule like "a reactivation
reason is at least ten characters" be written once and enforced in four places.

| | |
| --- | --- |
| **Package** | `@loadbearing/contracts` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `zod`, `@orpc/contract`, `@loadbearing/permissions` (type-only), and — once slices land — `@loadbearing/core` and `@loadbearing/errors` |
| **Used by** | `application`, `infrastructure`, `api-client`, `query`, `ui`, `feature`, `apps/*` |
| **Environment** | isomorphic — server, browser, worker, and Tauri webview |
| **Build** | `tsup` → `dist/index.js` + `dist/index.d.ts` |

```
packages/contracts/
├── vitest.config.ts
├── src/
│   ├── index.ts                     ← the public barrel; names only folder barrels
│   ├── import.ts                    ← zod, @orpc/contract, @loadbearing/permissions
│   ├── primitive/
│   │   ├── index.ts
│   │   ├── identifiers.ts           → Identifiers, OrganizationId, UserId, RoleId, GoalId,
│   │   │                                TaskId, ApiKeyId, InvitationId
│   │   ├── envelope.ts              → Envelope
│   │   ├── pagination.ts            → Pagination, PaginationQuery
│   │   └── password.ts              → Password   ← the bounds AuthFactory enforces
│   ├── procedure/
│   │   └── index.ts                 → contract, AppContract   ← merges every slice's procedures
│   ├── catalog/
│   │   ├── index.ts                 → PROCEDURE_PERMISSIONS, DOMAIN_EVENTS, ACTIVITY_ACTIONS
│   │   ├── <subject>.permissions.ts ← one fragment per slice, procedure path → key
│   │   ├── <subject>.events.ts      ← one fragment per slice, event name → payload schema
│   │   └── <subject>.actions.ts     ← one fragment per slice, audit action → label
│   ├── registry/
│   │   ├── index.ts
│   │   ├── activity-actions.ts      → ActivityActions, ActivityAction
│   │   ├── domain-events.ts         → DomainEvents
│   │   └── procedure-permissions.ts → ProcedurePermissions
│   ├── mail/                        ← a manifest, not a slice: no contract, no procedures
│   │   ├── index.ts
│   │   └── mail-template.manifest.ts → MailTemplates, MailTemplateKey, MailTemplateParams
│   └── <subject>/                   ← one folder per domain subject; `role/` and `member/` ship
│       ├── index.ts
│       ├── <subject>.contract.ts    → <Subject>Contract   (Zod shapes)
│       ├── <subject>.entity.ts      → <Subject>Entity     (behaviour, no I/O)
│       └── <subject>.procedures.ts  → <Subject>Procedures (oRPC)
└── tests/
    ├── primitive/
    │   ├── identifiers.spec.ts
    │   ├── envelope.spec.ts
    │   └── pagination.spec.ts
    ├── role/role.contract.spec.ts
    ├── member/member.contract.spec.ts
    ├── mail/mail-template.manifest.spec.ts
    └── registry/
        ├── domain-events.spec.ts
        └── procedure-permissions.spec.ts
```

---

## The four file roles a slice has

| File | Class | Answers |
| --- | --- | --- |
| `<subject>.contract.ts` | `TaskContract` | What shape is this data? |
| `<subject>.entity.ts` | `TaskEntity` | What does this data know about itself? |
| `<subject>.procedures.ts` | `TaskProcedures` | What operations exist, at what path? |
| `catalog/<subject>.permissions.ts` | — | Which permission gates each procedure path? |

The fourth is **not** in the subject folder. It is a cross-check — "does every declared procedure
have a gate" — rather than part of the subject's own definition, and it follows the fragment pattern
`@loadbearing/permissions` uses for its own catalog: one team, one file, no merge conflicts.

---

## No feature slices ship

`primitive/` is real. `procedure/` and `catalog/` are **empty merge points**, and that is the
deliverable: `contract` is `{}` and `PROCEDURE_PERMISSIONS` is `{}` until a product adds a slice.
The kit ships the seam, not a sample task tracker.

That makes the coverage test in `tests/registry/` vacuous against the real contract, so it runs
against a fixture built with `oc` as well — see
[procedure-permissions](reference/procedure-permissions.md). Without the fixture the test would be
green for the wrong reason and stay green through the first slice that forgot a gate.

---

## Two conversions that happen in exactly one place

**Timestamps are ISO strings in contracts, `Date` in entities.** The contract crosses a JSON
boundary and JSON has no date type: `z.iso.datetime()` at the edge, `new Date(…)` in `fromDto`.

**Identifiers are strings on the wire, branded types in code.** `Identifiers.taskId.parse(raw)` at
the boundary, and everything downstream is typed — see [identifiers](reference/identifiers.md).

---

## Schemas carry no messages

A schema never takes `{ message: … }`. Zod's own text is discarded, and a custom string would be
user-facing prose living outside `@loadbearing/content` — the one thing that split exists to
prevent. A failed rule becomes `{ field, rule, params }` and `content` renders it.

`z.string().min(10)` still declares the business rule exactly once. Only the sentence lives
elsewhere.

---

## Testing

Specs live in `tests/`, mirroring `src/`. `vitest.config.ts` sets
`resolve.conditions: ["development"]` so a spec resolves `@loadbearing/permissions` to its source
rather than a stale `dist/` — the same condition `apps/web/vite.config.ts` sets.

## Two pagination shapes, and the newer one is the default for growth

`Pagination` (`limit` + `offset`) still serves the lists bounded by the tenant — roles, members,
invitations. `Keyset` (`limit` + opaque `cursor`) serves the ones that grow with activity, and its
page carries no `total`, because an exact count over a partitioned table is exactly the cost keyset
pagination exists to avoid. Which to reach for, what the cursor encodes, and the query shape it
pairs with are in [keyset](reference/keyset.md).

## `mail/` is a manifest, not a slice

It holds no `.contract.ts`, no `.entity.ts` and no `.procedures.ts`, because a mail template is
never a procedure — nothing on the wire sends one. What it holds is a closed record of template key
→ params schema, which is the one shape both ends of the mail queue need: a publisher writes params
it can prove match the key, and the worker parses them back out of JSON it has to distrust.

**It is here rather than in `content` or `application` because of the layering, not by preference.**
`application` has no zod and may not import one; `contracts` may not import `content`, which sits to
its right. That leaves the recipient's `Locale` riding the `MailPublisher` port in `application`
(where the edge to `content` *is* legal, type-only) while the params live here.

Adding a key is deliberately more than one edit: the renderer switches on it with a `never` default,
so a new row does not compile until a template and its copy exist.

## `DomainEvents` is the same shape as `ProcedurePermissions`, on purpose

A catalog of team-owned fragments, merged in `catalog/index.ts`, read through a registry class with
a private constructor. Two lookups exist for the same reason in the same package because the
property they buy is the same: **the name union is a compile-time check in every layer**, so a
use-case cannot publish an event nothing declares and a subscriber cannot listen for one.

`.events.ts` keeps its meaning here — a catalog fragment — exactly as `.permissions.ts` already does
in two packages. It is `DOMAIN_EVENTS` and not `EVENT_CATALOG`: that name belongs to
`@loadbearing/observability`, and the two are different vocabularies. A domain event is a business
fact with a schema and a `published_at`; a log event code is a diagnostic that may be lost.
[Vocabulary](../../../docs/opinions/vocabulary.md) keeps them apart, and a spec asserts every event
name here is past tense.

## `ActivityActions` is the third of them, and the reason is a row

Same shape again: fragments in `catalog/`, merged, read through a registry class. What makes it
worth a third catalog rather than a widened second is that `projection_policy` holds **one row per
action** — whether it reaches ClickHouse and for how long — so an action with no entry is an action
with no policy, and `ActivityLogger.record` taking `ActivityAction` is what makes that impossible.

A fragment entry carries a `label` and not a schema, which is the whole difference from
`.events.ts`. A subscriber parses an event payload; nothing parses an audit payload, because the
audit trail is read by people. The label is what the projection screen renders beside the toggle.

One call site may emit two actions — `set-member-active.use-case.ts` picks between
`member.deactivated` and `member.reactivated` on the value it is writing — and both are entries.

**`envelope` is a discriminated union built once at module load.** One `parse` turns a job's JSON
back into a typed event, which is what keeps the consumer from reading `name` first and picking a
schema by hand — a second place to forget a case.

The payloads carry what a subscriber needs and no more. `member.invited` deliberately omits the
invitation token: `invitations` stores only its hash so that a dump of that table accepts nothing,
and an event carrying the plaintext would hand it straight back.
