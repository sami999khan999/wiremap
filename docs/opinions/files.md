---
title: Files
description: Kebab-case everywhere, a dot-suffix for every architectural role, one class per file.
---

# Files

## Everything is kebab-case, including React component files

Case-sensitive CI plus case-insensitive macOS produces Git renames that appear to change nothing.
Kebab-case sidesteps the entire class of problem, and `forceConsistentCasingInFileNames`
([04](../setup/04-typescript-configs.md)) catches what slips through.

## A file with an architectural role takes a dot-suffix

`<subject>.<role>.ts`

| Role suffix | Example file | Exports |
|---|---|---|
| `.contract.ts` | `task.contract.ts` | `TaskContract` |
| `.entity.ts` | `task.entity.ts` | `TaskEntity` |
| `.procedures.ts` | `task.procedures.ts` | `TaskProcedures` |
| `.use-case.ts` | `reactivate-task.use-case.ts` | `ReactivateTaskUseCase` |
| `.repository.ts` | `task.repository.ts` | `TaskRepository` |
| `.gateway.ts` | `s3-storage.gateway.ts` | `S3StorageGateway` |
| `.store.ts` | `pg-vector.store.ts` | `PgVectorStore` |
| `.reader.ts` | `loki-log.reader.ts` | `LokiLogReader` |
| `.logger.ts` | `pg-activity.logger.ts` | `PgActivityLogger` |
| `.provider.ts` | `openai-embedding.provider.ts` | `OpenAiEmbeddingProvider` |
| `.publisher.ts` | `bullmq-queue.publisher.ts` | `BullMqQueuePublisher` |
| `.resolver.ts` | `better-auth-session.resolver.ts` | `BetterAuthSessionResolver` |
| `.projector.ts` | `clickhouse-analytics.projector.ts` | `ClickHouseAnalyticsProjector` |
| `.sender.ts` | `smtp-email.sender.ts` | `SmtpEmailSender` |
| `.mailer.ts` | `content-auth.mailer.ts` | `ContentAuthMailer` |
| `.source.ts` | `static-content.source.ts` | `StaticContentSource` |
| `.renderer.ts` | `content-mail.renderer.ts` | `ContentMailRenderer` |
| `.subscriber.ts` | `member-realtime.subscriber.ts` | `MemberRealtimeSubscriber` |
| `.unit-of-work.ts` | `pg-unit-of-work.ts` | `PgUnitOfWork` |
| `.connection.ts` | `redis.connection.ts` | `RedisConnection` |
| `.cache.ts` | `capability.cache.ts` | `CapabilityCache` |
| `.hasher.ts` | `api-key.hasher.ts` | `ApiKeyHasher` |
| `.builder.ts` | `principal.builder.ts` | `PrincipalBuilder` |
| `.factory.ts` | `auth.factory.ts` | `AuthFactory` |
| `.seed.ts` | `system-role.seed.ts` | `SystemRoleSeed` |
| `.enroller.ts` | `pg-personal-organization.enroller.ts` | `PgPersonalOrganizationEnroller` |
| `.founder.ts` | `pg-organization.founder.ts` | `PgOrganizationFounder` |
| `.claimer.ts` | `pg-invitation.claimer.ts` | `PgInvitationClaimer` |
| `.rules.ts` | `role.rules.ts` | `RoleRules` |
| `.policy.ts` | `overdue-lock.policy.ts` | `OverdueLockPolicy` |
| `.strategy.ts` | `bearer-auth.strategy.ts` | `BearerAuthStrategy` |
| `.plugin.ts` | `organization.plugin.ts` | `OrganizationPlugin` |
| `.router.ts` | `task.router.ts` | `TaskRouter` |
| `.interceptor.ts` | `error.interceptor.ts` | `ErrorInterceptor` |
| `.consumer.ts` | `embedding.consumer.ts` | `EmbeddingConsumer` |
| `.schedule.ts` | `cleanup.schedule.ts` | `CleanupSchedule` |
| `.error.ts` | `forbidden.error.ts` | `ForbiddenError` |
| `.schema.ts` | `rbac.schema.ts` | Drizzle tables |
| `.config.ts` | `auth.config.ts` | `AuthConfig` |
| `.manifest.ts` | `image.manifest.ts` | `ImageManifest` |
| `.permissions.ts` | `task.permissions.ts` | a catalog fragment |
| `.errors.ts` | `core.errors.ts` | an error-catalog fragment |
| `.events.ts` | `core.events.ts` | an event-catalog fragment |
| `.actions.ts` | `member.actions.ts` | an activity-action fragment — the audit vocabulary |
| `.gate.ts` | `rbac.gate.ts` | a module-gate fragment |
| `.routes.ts` | `rbac.routes.ts` | a route fragment |
| `.flags.ts` | `widget.flags.ts` | a feature-flag fragment |
| `.widgets.ts` | `member.widgets.ts` | a widget-registry fragment |
| `.data.ts` | `nav.data.ts` | a content record |
| `.spec.ts` | `reactivate-task.use-case.spec.ts` | tests, in the package's `tests/` |

**React and the client packages add their own**, and they name a kind of component or hook rather
than a layer role:

| Role suffix | Example file | Exports |
|---|---|---|
| `.form.tsx` | `sign-in.form.tsx` | `SignInForm` |
| `.list.tsx` | `member-list.tsx`, `active-session.list.tsx` | a list component |
| `.panel.tsx` | `two-factor.panel.tsx` | `TwoFactorPanel` |
| `.button.tsx` | `sign-out.button.tsx` | `SignOutButton` |
| `.notice.tsx` | `verify-email.notice.tsx` | `VerifyEmailNotice` |
| `.setup.tsx` | `two-factor.setup.tsx` | `TwoFactorSetup` |
| `.inspector.tsx` | `effective-permissions.inspector.tsx` | `EffectivePermissionsInspector` |
| `.guard.tsx` | `session.guard.tsx` | `SessionGuard` |
| `.context.tsx` | `session.context.tsx` | a provider plus its hooks |
| `.client.ts` | `account.client.ts` | `AccountClient` |
| `.queries.ts` | `member.queries.ts` | `MemberQueries` |
| `.mutations.ts` | `session.mutations.ts` | `SessionMutations` |
| `.fn.ts` | `session.fn.ts` | a TanStack server function |
| `.server.ts` | `container.server.ts` | anything the server-only ban exempts by name |

**The set is closed, and closing it is the point.** A file whose role is not on either table is
either a plain kebab-case file with no layer role, or a decision to be made here first. The failure
this prevents is quiet: a role invented per package means `grep -l '\.reader\.ts'` stops answering
"where are the read seams", which is the question the suffix exists to answer.

**Files with no layer role stay plain kebab-case**: `permission-registry.ts`, `capability-set.ts`,
`clock.ts`, `container.ts`. This is why `core` and `permissions` read differently from
`application` — those classes are not *in* a layer, they are the vocabulary the layers use.

## One class per file, and the filename derives from the class

Mechanically: strip the role suffix from the class name, kebab-case the remainder, append
`.<role>.ts`. `ReactivateTaskUseCase` → `reactivate-task.use-case.ts`.

## Two exemptions to the subject-first order

**1. Use-case files lead with the verb.** `reactivate-task.use-case.ts`, not
`task-reactivate.use-case.ts`. The class is `ReactivateTaskUseCase`, and mirroring the class
outranks folder-prefix symmetry.

**2. Implementation files lead with the technology.** `pg-vector.store.ts`, `redis-cache.store.ts`,
`s3-storage.gateway.ts`, `bearer-auth.strategy.ts`. You should be able to see what you would delete
when a vendor changes.

> [!IMPORTANT]
> **The technology is joined with a hyphen, and only the role takes the dot.** `redis-cache.store.ts`,
> never `redis.cache-store.ts`. Both read the same aloud and only the first is greppable: the second
> spells the role `cache-store`, so `*.store.ts` misses it and the closed set above grows a synonym
> nobody decided on.
>
> Nineteen files were written the second way — every vendor adapter outside `pg/` and `s3/`, and
> their fakes in `composition/src/fake/`. That is what an unenforced convention looks like after a
> few months: the two files somebody checked are right, and the ones written beside them are not.

## Framework-dictated filenames win

`$goalId.tsx`, `-guard.ts`, `rpc.$.ts`, `vite.config.ts`, `drizzle.config.ts`, `tsup.config.ts`.
Inside `apps/web/src/route/` especially, TanStack's routing conventions are load-bearing — a `-`
prefix is what marks a file as *not* a route. Don't fight them.

## Banned filenames

`utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`. They are where unowned code goes to accumulate.
A barrel may re-export; it may never contain logic.

> [!NOTE]
> `packages/content/src/message/en/common.ts` is not an exemption. `common` there is a *namespace
> name* in a closed union — the file holds one locale's copy for that namespace, and the name is
> load-bearing rather than a shrug.

## Tests mirror `src/`, and never live inside it

`src/error/app.error.ts` is covered by `tests/error/app.error.spec.ts`. That keeps `src/` equal to
the shipped surface — `tsup` builds from `src/index.ts`, and the `development` export condition
resolves into `src/` — while the mirrored path preserves the one thing colocation was good at:
knowing where a subject's test is without looking.

`*.stories.tsx` is **not** a test and stays in `src/`.

### The mirror is the default, and `infrastructure` is the one package it does not fit

Every other package's `src/` is organised by subject, so mirroring it produces a `tests/` organised
by subject too, and the rule costs nothing. `infrastructure` is organised **by vendor** — `pg/`,
`redis/`, `s3/`, `smtp/` — because that is what makes `rm -r src/clickhouse/` the complete answer
to a swap. Mirroring that puts roughly twenty-five spec files in one flat `tests/pg/repository/`,
which is the same pile the vendor split exists to avoid, one directory further down.

So `infrastructure` organises `tests/` by **subject**: `rbac/`, `member/`, `messaging/`, `outbox/`,
`platform/`, `cold/`, `maintenance/`, `vector/`. It keeps vendor folders — `redis/`, `smtp/`,
`loki/`, `openai/`, `clickhouse/` — where a vendor's adapter is the subject, which is most of them
outside `pg/`.

**The deciding case is the spec that has no one file to mirror.** `tests/rbac/tenant-cascade.spec.ts`
asserts that deleting a tenant reaches every table that references it; `tests/maintenance/tenant-partition.spec.ts`
covers a seed, a gateway and the allowlist together. Neither is a test *of* a file, so the mirror
rule has no answer for where they go, and a rule with no answer gets one invented per author.

This is the only package with the exemption, and it is not a licence to reach for: the test is
whether `src/` is organised by something other than subject. Nothing else here is.
