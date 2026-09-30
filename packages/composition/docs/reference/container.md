---
title: Container
description: The four rules that govern the DI root — abstract types on the public surface, no request state, no process.env, reverse-order disposal — plus where use-cases go and why lazy instantiation is banned.
---

# `Container`

One class, no decorators, no reflection, no module graph. Four rules make it work, and
each of them prevents a specific failure.

## 1. Ports are exposed as their abstract types

```ts
public readonly vectors: VectorStore;      // not PgVectorStore
```

If the concrete type leaks into the public surface, a consumer eventually calls a Postgres-specific
method and the swap stops being one line. **The annotation is what enforces it** — TypeScript infers
`PgVectorStore` from the assignment otherwise, and nothing about the file would look wrong.

Two fields are deliberately concrete. `capabilities: CapabilityCache` and
`principals: PrincipalBuilder` are not adapters over a seam; they *are* the caching decision and the
credential-collapsing decision, and there is no second implementation to be abstract about.

## 1b. Swappable ports are chosen by a `driver`, not by a `new`

```ts
this.vectors = Container.buildVectorStore(config, this.cluster, this.transactions, this.shards);
```

Rule 1 makes the *type* swappable. This makes the *choice* configurable, and the two are not the same
claim.

**A seam with exactly one implementation is untested by construction.** Abstract types on the public
surface prove nobody calls a Postgres-specific method; they do not prove a second implementation could
be dropped in, because until one exists nothing has tried. A discriminated `driver` on
`ContainerConfig` is exercised the first time somebody flips the value — in an environment file, with
no code change.

`buildVectorStore` is a `switch` with a `never` default, so a driver added to the union and not to the
switch is a build error rather than a runtime surprise. `VECTOR_DRIVER` has one legal value today;
that is the point of writing it as a union rather than as nothing.

### The embedding vendor is a `SearchMode`, not an optional field

```ts
this.searchMode = Container.buildSearchMode(config.embedding, this.logger);
```

`EMBEDDING_PROVIDER` picks one of three cases. `none` gives `{ kind: "lexical" }`, and search runs
on text alone. `openai` and `gemini` give `{ kind: "semantic", provider }`, with an
`OpenAiEmbeddingProvider` or a `GeminiEmbeddingProvider` inside.

**A tagged value rather than a provider that might be missing.** A caller cannot reach a provider
without first reading `kind`, so "no key configured" is a branch the compiler makes you write, not a
`TypeError` at the first search. It is a `switch` like `buildVectorStore`, so a vendor added to the
union and not here fails the build. See
[`infrastructure/docs/reference/embedding.md`](../../../infrastructure/docs/reference/embedding.md).

## 2. Never build request-scoped state into the container

The `Principal` is passed as an argument to `execute()`, never held here. **One container per
process, not per request.**

Letting per-request state into the DI root couples you to a lifecycle model, and both the worker and
any future NestJS migration become expensive. It also removes the temptation to reach for
`AsyncLocalStorage` as ambient auth state — the one place this repository does use it is
`TransactionScope`, where the alternative is a `tx` parameter on every port method
([`infrastructure/docs/reference/unit-of-work.md`](../../../infrastructure/docs/reference/unit-of-work.md)).

## 3. Config arrives as a constructor argument

No `process.env` in this file or in any package. The two `env.ts` files are the boundary, and
Biome's `noProcessEnv` rule from [05](../../../../docs/setup/05-lint-and-format.md) is what keeps it
true.

**The logger's `app` and `env` are bound fields, not options.**

```ts
this.logger = new JsonLogger({
  level: config.logging.level,
  pretty: config.logging.pretty,
  bound: { app: config.logging.app, env: config.logging.env },
});
```

`JsonLoggerOptions` declares `level`, `pretty`, `sink`, `bound`, `clock` and `random` — and nothing
else. Spreading `config.logging` into it would **compile**, because excess-property checking does
not apply to a variable, and both values would be silently dropped: no error, no label, and a log
platform that cannot tell `web` from `worker`.

Binding them puts `app` and `env` on every line, which is what lets a log shipper read all four
labels out of the JSON body rather than inferring two of them from container metadata that differs
between Compose, Kubernetes, and a host-run `pnpm dev`
([11](../../../../docs/setup/11-local-infrastructure.md)). The application knows what it is; the
orchestrator's name for the process is incidental.

> [!NOTE]
> **`logger` is a shared primitive, not a port.** It sits with `clock` and `authorizer` rather than
> in the port block, and there is no `Logger` abstract class in `packages/application/src/port/` —
> the domain layer does not log at all
> ([`application/docs`](../../../application/docs/index.md)). The seam lives in
> `@loadbearing/observability`, low enough in the graph that `infrastructure`, `auth`, and both
> apps can reach it.

## 4. `dispose()` closes in reverse construction order

```ts
await this.queuePublisher.close();
await this.redis.close();
await this.emailSender.close();
await this.cluster.close();
```

Queues before the Redis connections before Postgres. Closing Redis while BullMQ still holds blocking
connections produces a hang on shutdown that looks like a deadlock, because it is one.

**The SMTP transport is held concretely as `emailSender` and exposed as `email`**, the same split as
`queuePublisher`/`queue`. `EmailSender` is a port and says nothing about a transport's lifetime, so
the container keeps the implementation to close it — and for a while did not close it at all.
Nodemailer keeps sockets open between sends, and a process that exits without closing them waits on
the SMTP server to time each one out. Its position in the order carries no meaning beyond "before
Postgres": nothing depends on it, which is exactly why it was the one that got forgotten.

`RedisConnection.close()` quits both instances, which is why they sit behind one object rather than
as two fields on the container. Two fields is two things to remember at every shutdown path, and the
one that gets forgotten is the queue — where an unclean close means in-flight jobs are redelivered
rather than completed.

**`cluster.close()` is the one Postgres close, and it is last.** The cluster owns every pool it
built — node 0's pooled and direct connections included, which are what `database` and
`directDatabase` point at — so closing it closes them, and closing them separately would close the
same pool twice. Last because a repository on any node may still be finishing one of the lines
above it.

**The logger is constructed first and disposed last**, which is the same rule read from both ends.
Constructed first, because a `Database` that cannot reach Postgres should produce a structured line
rather than a stack trace on stderr. Disposed last, because everything closing above it may have
something to say on the way out.

## `health()` pings what callers actually hold

```ts
const [database, cache, queue, realtime] = await Promise.all([
  this.cluster.isHealthy(),
  this.redis.healthy("cache"),
  this.redis.healthy("queue"),
  this.redis.opened("subscriber") ? this.redis.healthy("subscriber") : Promise.resolve(null),
]);

return {
  healthy: Object.values(database).every(Boolean) && cache && queue && realtime !== false,
  database, cache, queue,
  analytics: null,
  realtime,
  pool: this.database.stats(),
};
```

**`database` is keyed by node index, not a boolean.** A single-node deployment reads `{ 0: true }`
— the same answer the boolean was, and it says which node it is. Two nodes and one down reads
`{ 0: true, 1: false }`, which is the difference between "restart this pod" and "page whoever owns
shard 1"; a rolled-up `false` says neither. `pool` stays this process's own node-0 pool, because
the shards are separate servers and one gauge over all of them would average a saturated pool with
an idle one.

`ContainerHealthReader` folds the record back to a boolean for `PlatformHealth`, the same narrowing
it already does to drop `pool`. Which node is down is an operator's question and the readiness
endpoint answers it; the platform screen is asking whether to worry.

Postgres and **both** Redis instances. A cache that is down degrades; a queue that is down silently
stops accepting work, which is worth knowing about — and the two are separate servers with different
eviction policies, so one being up says nothing about the other.

**It returns a breakdown rather than one boolean**, because the only consumer is a readiness probe,
and the body of a failing probe is what an operator reads at three in the morning. `false` alone says
the deployment is unhealthy; it does not say whether to restart the pod or page whoever owns Redis.

**`analytics` is always `null`.** Lite runs no analytics store, and `null` means "not part of this
deployment" — not healthy, not degraded. The field stays so the status contract keeps its shape for
a kit that ports analytics back ([`docs/scale/analytics.md`](../../../../docs/scale/analytics.md)).

**The realtime subscriber follows the same `null` rule, for a different reason.** Analytics is
absent because the deployment does not run it; the subscriber connection is absent because
*nothing in this process has opened a stream yet* — which is every worker, always, and a web
replica until its first signed-in tab. `opened("subscriber")` is what makes that answerable:
calling `healthy("subscriber")` would **create** the connection, and a worker reporting `true` for
a socket it opened purely in order to answer the question is reporting on itself.

Once a stream has been opened it is a real dependency and reports like one, which is why the
roll-up reads `realtime !== false` rather than ignoring it. A web replica whose subscriber
connection has died serves every request correctly and delivers nothing, and that is exactly the
failure a readiness probe should catch — the pod looks fine from every other angle.

**No log store is on this list.** Lite writes JSON to stdout and reads nothing back, so there is
nothing to ping. Whatever ships those lines stays off the probe even when you add one: a log
pipeline being down loses diagnostics and nothing else, and failing readiness over it takes the
application down to protect its logs — backwards during the incident where the logs matter most.
See [`docs/scale/logs.md`](../../../../docs/scale/logs.md).

`RedisConnection.healthy(role)` takes the role rather than handing out a client, which is what keeps
`ioredis` confined to `packages/infrastructure`. It pings the memoised connection the cache store and
the queue publisher are already using; opening a second connection to answer a health check would
report green on a socket nothing else uses.

## Enrolment mode is a binding, not a policy

```ts
private static enroller(mode, personal, bootstrap, claimer): MembershipEnroller
```

Three modes, one env var, one decorator around all of them, and **this method is the only line in
the system that knows which is which**. Tenancy is the decision a starter kit is most likely to be
forked over, so it is resolved here rather than baked into an enroller — which is exactly what a DI
root is for.

| `AUTH_ENROLMENT_MODE` | Adapter | Posture |
|---|---|---|
| `personal` | `PgPersonalOrganizationEnroller` | The default: the only mode that works against an empty database, so a fresh clone can sign up and be signed in without `pnpm db:seed` having run |
| `bootstrap` | `PgBootstrapMembershipEnroller` | The demo and single-tenant posture |
| `invite` | `NullMembershipEnroller` | Production: the decorator is the only door, and an address nobody invited is refused a session by `MembershipReader` |

Every one of the three is wrapped in `InvitationClaimingEnroller`, so an invited address joins the
organization that invited it **before** the mode is consulted at all. See
[`auth/docs/reference/enrolment.md`](../../../auth/docs/reference/enrolment.md).

The enroller block, and everything else gated on `config.auth`, is skipped entirely in a process
that never authenticates: `apps/worker` builds a `SystemPrincipal` from a named grant list and
resolves no credential.

## The one nominal binding in the repository

```ts
const membershipReader: MembershipReader = new PgMembershipReader(
  this.database,
  this.transactions,
);
```

`MembershipReader` is declared in `@loadbearing/auth` and implemented in `@loadbearing/infrastructure`, which
cannot import it — `auth` already depends on `infrastructure`, so the arrow cannot point back.
`PgMembershipReader` therefore satisfies it **structurally**, and nothing checks that until the two
meet. The annotation on this local is that check. Drop it and a signature drift compiles everywhere
and fails at sign-in.

`PgApiKeyRepository` → `ApiKeyRepository` is the same arrangement one line down, checked by the
`ApiKeyResolver` constructor rather than by an annotation.

## Where use-cases go

A container with fifty use-cases as fields is unwieldy but it is honest, and it is still simpler than
a module graph. Group by slice — one private method per module, returning a small object:

```ts
public readonly task: TaskUseCases;

// …
this.task = this.buildTaskUseCases();

private buildTaskUseCases(): TaskUseCases {
  const tasks = new PgTaskRepository(this.database, this.transactions);
  return {
    create: new CreateTaskUseCase(tasks, this.authorizer, this.activity),
    reactivate: new ReactivateTaskUseCase(tasks, this.authorizer, this.activity, this.clock),
  };
}
```

The oRPC router then reads `context.container.task.reactivate.execute(...)`, which mirrors the
contract path exactly.

**Do not add lazy instantiation.** The temptation is a `get reactivateTask()` that constructs on
first access. It saves microseconds at boot and costs you the property that a container which
constructs successfully is a container where every dependency resolved. Eager construction means a
wiring mistake is a **startup crash** rather than a request-time surprise at 3am.

## `ContainerHealthReader` is the one place the container implements a port

`Container` builds adapters; it does not usually *be* one. `PlatformHealthReader` is the exception,
and the reason is the layering rather than a design preference: the platform status use-case
reports what `health()` already answers, `health()` lives here, and `application` may not name this
package. The seam is forced.

```ts
this.platformAdmin = {
  inspectStatus: new InspectPlatformStatusUseCase(
    this.authorizer,
    this.platform,
    new ContainerHealthReader(this),
  ),
};
```

Two things about that `this`. It is the **last** block the constructor runs, so every field it
could reach is assigned; and `report()` is called on a request, never during the build — the reader
holds the container, it does not read it. Both are why this is not the lazy instantiation the
section above bans: nothing here is deferred, only the *call*.

`PlatformHealth` narrows `HealthReport` by dropping `pool`. A screen showing a pool gauge would be
showing one process's, which is not the deployment's.

## The mail block is outside the `auth` branch, and that was a bug

`ContentAuthMailer` and `ContentInvitationMailer` used to be constructed inline inside
`if (config.auth)`. The worker parses no auth configuration, so the process that is *supposed* to
send mail had no mailer at all — the wiring read as though mail belonged to authentication when in
fact only two of its callers did.

Now `mailPublisher`, `mailRenderer` and `mail.send` are built unconditionally, beside `email`:

```ts
this.mailPublisher = new QueuedMailPublisher(this.queue);
this.mailRenderer = new ContentMailRenderer(this.content);
this.mail = { send: new SendMailUseCase(this.mailRenderer, this.email) };
```

`mailPublisher` is public because Phase 3's notification subscriber holds one. `mailRenderer` stays
private: `mail.send` is the only thing with any business calling it, and a second caller would be a
second place that decides what a message looks like.

The two mailers still live in the `auth` branch, and that is correct — `QueuedAuthMailer` is passed
to `AuthFactory`, and `QueuedInvitationMailer` to `InviteMemberUseCase`. What changed is that both
now take a `MailPublisher` instead of an `EmailSender`, so neither renders anything and neither
needs a `ContentSource`. `QueuedInvitationMailer` takes its origin from `config.email.baseUrl` rather
than `config.auth.baseUrl`, which is the other half of what kept mail trapped in that branch.

## Smells

- The word `if` anywhere except reading a config flag — logic has crept in.
- A concrete class name in a public field's type annotation.
- A getter. See above.
- A field holding a `Principal`, a `Request`, or anything else that belongs to one request.
