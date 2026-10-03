---
title: "@loadbearing/application"
description: Principal, Authorizer, and the abstract ports. Zero framework imports and no third-party runtime dependency — the package that makes every infrastructure decision reversible.
---

# `@loadbearing/application`

If `ReactivateTaskUseCase` lives inside a TanStack Start server function, swapping the transport
means rewriting business logic. If it lives here, the transport is a hundred lines of adapter.

That is the whole argument, and it has a mechanical test:

```bash
grep -rE "@orpc|@tanstack|@nestjs|drizzle|ioredis|aws-sdk|better-auth" packages/application/src
```

It returns nothing, and `check-architecture.mjs` §1 asserts it in CI.

| | |
| --- | --- |
| **Package** | `@loadbearing/application` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `@loadbearing/contracts`, `@loadbearing/content` (**the `Locale` type only**), `@loadbearing/core` (`ServerOnly`), `@loadbearing/errors` (`ForbiddenError`), `@loadbearing/permissions` — no third-party runtime dependency, ever |
| **Used by** | `infrastructure`, `auth`, `composition`, `apps/worker` — **never** a browser bundle |
| **Environment** | server-only; `ServerOnly.assert()` is the runtime tripwire |
| **Build** | `tsup` → `dist/index.js` + `dist/index.d.ts` |

```
packages/application/
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── import.ts                 ← ServerOnly, ForbiddenError, ids, CapabilitySet
│   ├── primitive/
│   │   ├── index.ts
│   │   ├── principal.ts          → Principal, PrincipalKind
│   │   ├── queue-name.ts         → QueueName
│   │   ├── partitioned-table.ts  → PartitionedTable, PartitionedTableName
│   │   └── authorizer.ts         → Authorizer
│   ├── port/                     ← abstract classes only, zero implementations
│   │   ├── index.ts
│   │   ├── activity.logger.ts    → ActivityLogger
│   │   ├── partition-archive.gateway.ts → PartitionArchiveGateway, ArchivedPartition
│   │   ├── cache.store.ts        → CacheStore
│   │   ├── capability.invalidator.ts → CapabilityInvalidator
│   │   ├── email.sender.ts       → EmailSender, EmailMessage, EmailReceipt
│   │   ├── embedding.provider.ts → EmbeddingProvider, EmbeddingPurpose
│   │   ├── maintenance.gateway.ts → MaintenanceGateway, SweepOutcome
│   │   ├── queue.publisher.ts    → QueuePublisher, JobOptions
│   │   ├── session.resolver.ts   → SessionResolver, ResolvedSession, RequestHeaders
│   │   ├── storage.gateway.ts    → StorageGateway, StoredObject
│   │   ├── unit-of-work.ts       → UnitOfWork
│   │   └── vector.store.ts       → VectorStore, DocumentChunk, StaleChunk, SearchHit
│   ├── ai/
│   │   ├── ai-search-mode.ts           → SearchMode
│   │   ├── index-document.use-case.ts  → IndexDocumentUseCase
│   │   ├── reembed-chunks.use-case.ts  → ReembedChunksUseCase
│   │   └── search-documents.use-case.ts → SearchDocumentsUseCase
│   ├── mail/                    ← a slice with no repository: the queue is the state
│   │   └── send-mail.use-case.ts       → SendMailUseCase, SendMailInput
│   ├── member/                   ← a slice: its repository ports live with it
│   │   ├── member.repository.ts        → MemberRepository, MemberRecord, MemberPage
│   │   ├── invitation.repository.ts    → InvitationRepository, InvitationRecord
│   │   ├── invitation.mailer.ts        → InvitationMailer, InvitationMail
│   │   ├── invite-member.use-case.ts   → InviteMemberUseCase
│   │   ├── list-members.use-case.ts    → ListMembersUseCase
│   │   ├── list-invitations.use-case.ts → ListInvitationsUseCase
│   │   └── revoke-invitation.use-case.ts → RevokeInvitationUseCase
│   ├── platform/                 ← above every tenant; its seams live with it too
│   │   ├── platform.reader.ts          → PlatformReader, PlatformOrganization
│   │   ├── platform-health.reader.ts   → PlatformHealthReader, PlatformHealth
│   │   └── inspect-platform-status.use-case.ts → InspectPlatformStatusUseCase
│   └── rbac/
│       ├── role.repository.ts          → RoleRepository, RoleRecord, RolePage
│       ├── capability.repository.ts    → CapabilityRepository
│       └── list-roles.use-case.ts      → ListRolesUseCase
└── tests/
    ├── primitive/{principal,authorizer}.spec.ts
    ├── ai/index-document.use-case.spec.ts
    ├── rbac/list-roles.use-case.spec.ts
    ├── mail/send-mail.use-case.spec.ts
    └── member/{invite-member,list-members,revoke-invitation}.use-case.spec.ts
```

## This package does not log

A use-case records a business fact through `ActivityLogger`, or it throws a typed error. That is its
entire vocabulary, and `check-architecture.mjs` §2 asserts the missing `@loadbearing/observability`
import.

Those are two of the four data streams, and they differ in the way that matters: an audit row **must
not** be lost and commits inside the transaction; a diagnostic line **may** be lost and goes to
stdout. Writing one where the other belongs is the failure
[Data and scale](../../../docs/opinions/data-and-scale.md) exists to prevent.

The rule pays for itself immediately. Nothing threads a third argument into
`execute(actor, input)`, there is no ambient request context, and a `ForbiddenError` gets logged
**once** — at the boundary that catches it, with its full structured context — rather than three
times on the way up, each layer adding a little and losing a little.

## The ports

Every one is an **abstract class**, not an interface: abstract classes exist at runtime, so `extends`
gives a real prototype chain and `noImplicitOverride` catches a rename.

| Port | Implemented by | Swap target |
| --- | --- | --- |
| `ActivityLogger` | `PgActivityLogger` | never; audit is Postgres at every scale |
| `PartitionArchiveGateway` | `PgPartitionArchiveGateway` | never — it *is* the Postgres side |
| `CacheStore` | `RedisCacheStore` | managed Redis |
| `CapabilityInvalidator` | `CapabilityCache` — `auth` | any cache the resolver reads |
| `EmailSender` | `SmtpEmailSender` | any provider that speaks SMTP |
| `EmbeddingProvider` | `OpenAiEmbeddingProvider`, `GeminiEmbeddingProvider`, or none | any embedding API |
| `MailPublisher` | `QueuedMailPublisher` — `composition` | never; the queue is the pipeline |
| `MailRenderer` | `ContentMailRenderer` — `composition` | a template engine, if one earns it |
| `MaintenanceGateway` | `PgMaintenanceGateway` | never |
| `QueuePublisher` | `BullMqQueuePublisher` | managed Redis |
| `SessionResolver` | Better Auth — `auth` | any session library |
| `StorageGateway` | `S3StorageGateway` | S3, R2 |
| `UnitOfWork` | `PgUnitOfWork` | never |
| `VectorStore` | `PgVectorStore` | a dedicated vector database |

Everything unattributed is in `@loadbearing/infrastructure`. Read that list against `container.ts`
and every name lines up with exactly one binding, with no exceptions — which is the property this
table exists to make checkable. **Repository ports are not here** — each lives with its feature slice,
`src/member/member.repository.ts`, so a slice is one glob and `CODEOWNERS` stays honest.
`VectorStore` is the exception because it is one cross-cutting read seam
that many subjects query, not one per subject: the test is whether a new feature adds a *method* here
or a *file*.

### Diagnostics have no port

`JsonLogger` writes JSON to stdout, and a collector can tail it. The write path has no port because
it has no dependency. Nothing here reads logs back. The big kit's log reader is in
[`docs/scale/logs.md`](../../../docs/scale/logs.md).

## One port carries a required permitted scope

`VectorStore.search()` and `searchText()` take `goalIds` as a required parameter, and that is the security design
rather than a convenience.

```ts
const goalIds = actor.capabilities.goalsWith("ai.embedding.read", input.goalIds ?? []);
const hits = await this.vectors.search(actor.organizationId, embedding, provider.model, goalIds, limit);
```

Filtering *after* retrieval means the model has already seen documents the actor cannot access, and
"we filter the output" is not a defence anyone wants to explain after an incident. Putting the
permitted scope in the signature means it cannot be forgotten — a caller must produce it.

It matters more once the store is remote. There is no join back to goal membership from Qdrant, so a
scope that is not in the argument list does not exist.

`search()` also takes the provider's `model`, and compares only chunks that model wrote. Vectors
from two models are never compared. `ReembedChunksUseCase` rewrites the chunks whose vector is
missing or another model's, through `stale()` and `saveEmbeddings()`.

## A flag is asked before a permission

`FlagCache.assertOn(actor, key)` is meant to run first, and only then a key asserted. The order is
the point: a feature this organization does not have yet is not a feature the caller lacks a right
to, so it answers `NOT_FOUND` rather than `FORBIDDEN`. The error carries no flag name, because
`toJSON()` reaches the browser.

Lite declares no flags, so nothing calls it yet. The big kit's widget flags are in
[`docs/scale/widgets.md`](../../../docs/scale/widgets.md).

## Reference

- [Authorizer](reference/authorizer.md) — the gate, the load-assert-work shape, and the one leak it accepts
- [The ports](reference/ports.md) — one section per port whose reasoning outgrew a two-line comment:
  the ones that carry no `Principal`, and what each method refuses to offer

- [The platform slice](reference/platform.md) — what a use-case above the tenant may assume, why
  its health seam is a slice port, and the audit rebase that keeps a global change out of a
  customer's trail

- [Docs](reference/doc.md) — why the platform's docs are the platform organization's rows, a
  page rendered once and read from one row, and who may read a public or granted space.
- [Organization access](reference/organization-access.md) — wiremap's viewer role, member removal,
  shareable links, auto-join domains, teams, ownership transfer, owner deletion and the audit log.
