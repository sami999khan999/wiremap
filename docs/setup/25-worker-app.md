# 25 · `apps/worker` — background jobs

> A standalone Node process that shares the container and shares nothing else. No HTTP server, no framework, no shortcuts around the domain.

**Delivers:** A BullMQ worker that consumes queues and runs schedules, using the same use-cases the web app uses.

**Prerequisite:** [24 · `apps/web`](24-web-app.md)

---

## Why a separate process

The web app and the worker have opposite failure profiles. A request handler should die fast and be restarted; a job runner should drain gracefully and retry. They scale on different axes — you might want six web instances and one worker, or the reverse. And an embedding job that pins a CPU core for eight seconds must not sit inside the process serving your latency-sensitive traffic.

Running BullMQ inside the web process also breaks the moment you run two web instances: every repeatable job fires twice.

**The worker is not "the web app without routes".** It is a peer application that consumes the same `packages/`.

---

## Layout

```
apps/worker/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── import.ts                     ← the outside surface: every external symbol, once
│   ├── env.ts                        → Env  ★ the second process.env reader; keeps its own imports
│   ├── main.ts                       ← entrypoint. Resolved by name, so it stays loose
│   ├── bootstrap/                    ← what the process assembles before it starts working
│   │   ├── index.ts
│   │   ├── worker-bootstrap.ts       → WorkerBootstrap
│   │   └── system-principal.ts       → SystemPrincipal
│   ├── consumer/
│   │   ├── index.ts
│   │   ├── embedding.consumer.ts     → EmbeddingConsumer
│   │   ├── mail.consumer.ts          → MailConsumer        (the only sender in the system)
│   │   ├── maintenance.consumer.ts   → MaintenanceConsumer
│   │   └── analytics.consumer.ts     → AnalyticsConsumer   (registered only when configured)
│   └── schedule/
│       ├── index.ts
│       ├── cleanup.schedule.ts       → CleanupSchedule
│       ├── partitions.schedule.ts    → PartitionsSchedule
│       ├── archive.schedule.ts       → ArchiveSchedule
│       ├── projection.schedule.ts    → ProjectionSchedule  (analytics)
│       └── reconcile.schedule.ts     → ReconcileSchedule   (analytics)
└── tests/                            ← mirrors src/, never inside it
    ├── bootstrap/system-principal.spec.ts
    ├── consumer/mail.consumer.spec.ts
    └── consumer/maintenance.consumer.spec.ts
```

---

## Step 25.1 — Package files

**`apps/worker/package.json`**

```json
{
  "name": "@loadbearing/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```
> No bundler. The worker runs on Node directly, so `tsc` emitting plain ESM is the whole build. `tsx watch` gives the same reload loop the web app has.

### Why not Node's native TypeScript support

Node 24 runs `.ts` files directly by stripping types, which looks like it should replace `tsx` here. It cannot, for a specific reason: **type stripping only erases syntax, so it rejects any TypeScript construct that emits runtime code** — enums, namespaces, decorators, and, decisively, **constructor parameter properties**.

```ts
// every class in this repository looks like this
public constructor(private readonly clock: Clock) {}
```

That form is not merely used, it is *mandated* by the `parameter-properties` ESLint rule from [05](05-lint-and-format.md). Native stripping would reject the first file it read. `tsx` transpiles rather than strips, so it handles all of it.

Revisit this only if you ever set `erasableSyntaxOnly: true` and rewrite every constructor to explicit field assignment. That is a large change to remove one dev dependency, and it costs you the rule that keeps constructors declarative.

```bash
pnpm add --filter @loadbearing/worker \
  @loadbearing/composition@workspace:* @loadbearing/application@workspace:* \
  @loadbearing/infrastructure@workspace:* @loadbearing/permissions@workspace:* \
  @loadbearing/contracts@workspace:* @loadbearing/content@workspace:* \
  bullmq@catalog: ioredis@catalog: zod@catalog:
pnpm add --filter @loadbearing/worker -D tsx@catalog: typescript@catalog: \
  rimraf@catalog: vitest@catalog: @types/node@catalog:
```
> No `api-client`, no `ui`. The worker never speaks HTTP and never renders. It reaches use-cases through the container.
>
> **`contracts` is here for the DTOs a use-case answers with**, not for a transport — the worker has none. `core` is not, because nothing here needs a primitive that `application` does not already re-export through its ports.
>
> `infrastructure` is here for `RedisConnection`, and `ioredis` for the `Redis` type on the consumer constructor. `QueueName` comes from `application`: which queue a job belongs on is a domain decision, and `application` cannot import `infrastructure` to say it. Both are server-only, which is fine — the worker is a server process and the [05](05-lint-and-format.md) boundary applies to React packages and `apps/web`.
>
> **`content` is here because the worker sends email**, and email has words in it. It cannot
> import `feature` — that is React — so it takes the plain `Translator` instead. This is the
> dependency that makes `@loadbearing/content` being React-free a requirement rather than a
> preference ([20](20-content-package.md)), and it is the only process that ever loads the
> `email` namespace.

**`apps/worker/tsconfig.json`**

```json
{
  "extends": "@loadbearing/tsconfig/node-esm.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

**No lint config here either.** The `apps/*/src/env.ts` exemption lives in `tooling/biome-config/src/base.json`, which the root `biome.json` does nothing but extend — so this app's `env.ts` is covered by the same glob that covers the web app's.

---

## Step 25.2 — `Env`

`apps/worker/src/env.ts` is structurally identical to the web app's: a Zod schema parsed at module load, exposing `containerConfig()`.

**It parses the same `LOG_LEVEL` and `LOG_PRETTY` the web app does**, and returns the same `logging` block. A worker with no log output is a worker you cannot operate.

**It parses a smaller schema.** The worker needs `DATABASE_URL`, both Redis URLs, the S3 block, the embedding block, and `SMTP_URL` / `EMAIL_FROM` — it is the process that sends the digest. It does **not** need `AUTH_SECRET`, `AUTH_URL`, or `AUTH_TRUSTED_ORIGINS`: it never issues or validates a session.

**Four keys exist only here**, all defaulted, because each is an operational dial rather than a secret:

| Key | Default | What it decides |
|---|---|---|
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `25000` | How long `stop()` waits for in-flight jobs before the race gives up. Under the platform's own SIGKILL timer, deliberately |
| `WORKER_EMBEDDING_CONCURRENCY` | `4` | In-flight embedding jobs per instance |
| `WORKER_MAINTENANCE_CONCURRENCY` | `1` | Serial by default: these jobs take table-level locks and deadlock on the same partition |
| `WORKER_ANALYTICS_CONCURRENCY` | `1` | Capped at 1 in the schema, not by convention — the projection holds a keyset cursor and two runs would interleave batches |

Two of the four are capped or defaulted to `1` for reasons that are silent when wrong: a second maintenance job deadlocks, a second projection run duplicates rows. Raising either needs the reason to have changed, not just the number.

**Do not share one `env.ts` between the two apps by extracting it to a package.** The whole point of the `process.env` rule is that each deployable declares exactly what it needs. A shared schema would force the worker to carry an `AUTH_SECRET` it never uses, which is one more secret in one more environment for no reason.

Adapt `containerConfig()` to return the same shape minus `auth`, and make the `auth` block optional in `ContainerConfig` — the container only constructs `AuthFactory` when it is present.

---

## Step 25.3 — `SystemPrincipal`

Jobs have no user. They still need a principal, because `Authorizer.assert()` is not optional.

**`apps/worker/src/bootstrap/system-principal.ts`**

```ts
import { Principal } from "@loadbearing/application";
import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { CapabilitySet, PermissionRegistry, type PermissionKey } from "@loadbearing/permissions";

// Narrow, explicit, and reviewed. Never PermissionRegistry.instance.all(), and
// no core.*: every resolved principal already holds those.
const DECLARED: readonly string[] = ["ai.embedding.write", "ai.embedding.read"];

// Checked once at module load, which is what "at boot" has to mean.
const GRANTS: readonly PermissionKey[] = Object.freeze(
  DECLARED.map((key) => {
    if (!PermissionRegistry.instance.isKnown(key)) {
      throw new Error(`System principal references unknown permission: ${key}`);
    }
    return key;
  }),
);

export class SystemPrincipal {
  private constructor() {}

  // A fixed, reserved uuid rather than the organization's own: an actor column
  // holding a tenant id reads as a user.
  public static readonly USER_ID = "00000000-0000-7000-8000-000000000001";

  public static forOrganization(organizationId: string): Principal {
    return Principal.system(
      organizationId as OrganizationId,
      SystemPrincipal.USER_ID as UserId,
      CapabilitySet.from({
        wildcard: false,
        org: { grants: GRANTS, denies: [] },
        goals: {},
      }),
    );
  }
}
```

> [!IMPORTANT]
> Three things here are easy to get wrong, and all three are compile or boot failures rather than silent bugs:
>
> - **`CapabilitySet.from(dto)`, never `new CapabilitySet(...)`** — the constructor is private ([08](08-permissions-package.md)), and the argument is a `CapabilitySetDto`, not a list of `{ permission, goalId }` pairs.
> - **`PermissionRegistry.instance.isKnown(...)`** — `isKnown` is an instance method on the singleton, not a static.
> - **`DECLARED` is `readonly string[]`, not `as const`.** A literal-union type cannot be narrowed to `PermissionKey` by the type predicate unless the keys already exist in the catalog, so `as const` makes the `.map()` fail to typecheck.
> - **The validated list is module-level and frozen, not a `static readonly` field.** That is the same rule `PermissionRegistry` follows for its own derived views: static mutable state is banned ([Rules · Classes](../ai/rules/classes.md)), and `Object.freeze` is what makes "derived once" true rather than intended.
> - **`Principal.system` takes three arguments** — organization, actor, capabilities. Passing the organization id as the user id compiles only until the brands diverge, and lands a tenant id in the audit trail's actor column.
>
> Both keys above are real: `ai.embedding.write` and `ai.embedding.read` ship in `packages/permissions/src/catalog/ai.permissions.ts`. Name one that does not and this throws at boot, which is the rule working — a system principal referencing a permission that does not exist should never start.

**No `core.*` key is granted here, deliberately.** `CapabilitySet.can()` holds every `core.*` key for any resolved principal, so granting one would read as a decision where none was made. That is the fifth resolution rule in [`packages/permissions/docs/reference/capability-set.md`](../../packages/permissions/docs/reference/capability-set.md).

**A wildcard here would erase every authorization guarantee in the codebase.** The moment `SystemPrincipal` carries `PermissionRegistry.all()`, any bug that lets user input reach a job path becomes a full privilege escalation. Two named permissions, added deliberately, reviewed like any other grant.

**The `isKnown()` check runs once, at module load.** It used to run inside `forOrganization`, which is to say on every job: the registry is a singleton and the lookup is cheap, so the cost was never the argument — the problem was that a renamed permission then surfaced on the first job at 3am rather than at start-up, while the comment above it said "at boot". `CATALOG` is a compile-time constant with no dynamic registration, so there is no import-order window in which this can see a half-built registry.

**Every job carries an organization.** There is no global system principal, because there is no global data — a job that processes rows must know whose rows.

**And that is also what places it.** `withShard(container, organizationId, work)` builds a
`SystemPrincipal` for the tenant and hands it to `container.placed` — the worker's equivalent of
the web app's middleware, once per job rather than once per request. A per-tenant handler that
forgets it reaches a routed repository with no shard in scope, which throws.

The passes with no tenant to derive a key from — the outbox drain, the partition runway, the
digest fan-out — use `container.eachShard` instead and walk the nodes serially. Which loops which
way, and why the projection is the exception, is in
[the consumers](../../apps/worker/docs/reference/consumers.md).

---

## Step 25.4 — A consumer

**`apps/worker/src/consumer/embedding.consumer.ts`**

```ts
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { Container } from "@loadbearing/composition";
import { QueueName } from "@loadbearing/infrastructure";
import { SystemPrincipal } from "../bootstrap/index.js";

interface EmbeddingJobData {
  readonly organizationId: string;
  readonly documentId: string;
  readonly text: string;
  readonly goalId?: string | null;
  readonly sourceType?: string;
}

export class EmbeddingConsumer {
  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
    private readonly concurrency: number,
  ) {}

  public start(): Worker {
    return new Worker<EmbeddingJobData>(
      QueueName.EMBEDDING,
      async (job: Job<EmbeddingJobData>) => this.handle(job),
      { connection: this.connection, concurrency: this.concurrency },
    );
  }

  // Public, so a spec can drive one job without standing up a Redis connection.
  public async handle(job: Job<EmbeddingJobData>): Promise<void> {
    const principal = SystemPrincipal.forOrganization(job.data.organizationId);
    await this.container.ai.indexDocument.execute(principal, {
      documentId: job.data.documentId,
      text: job.data.text,
      goalId: job.data.goalId ?? null,
      sourceType: job.data.sourceType ?? "document",
    });
  }
}
```

**The consumer is a thin adapter, exactly like an oRPC router.** Deserialise the job, build a principal, call a use-case. All the logic lives in `IndexDocumentUseCase`, which is testable without Redis and callable from an HTTP endpoint too.

**`concurrency` is a constructor argument, not a literal**, and `WorkerBootstrap` passes `Env.embeddingConcurrency` — one queue's throughput is an operational decision, and burying it in a consumer means a redeploy to change it.

**It is per worker instance, not global.** Four instances at concurrency 4 is sixteen in-flight jobs, and each one may hold a Postgres connection. Keep `concurrency × instances` below your pool size.

**Let the handler throw.** BullMQ's retry and backoff are driven by rejection. Catching and logging turns a retryable failure into permanent silent data loss.

**Which is exactly why job failures are logged from the `failed` event, not from a `catch`:**

```ts
const worker = new Worker<EmbeddingJobData>(QueueName.EMBEDDING, /* … */);

worker.on("failed", (job, error) => {
  this.container.logger.failure(error, {
    queue: QueueName.EMBEDDING,
    jobId: job?.id ?? "unknown",
    attempt: job?.attemptsMade ?? 0,
  });
});
```

The listener observes without swallowing, so BullMQ still sees the rejection and still retries. `logger.failure` normalises whatever was thrown, reads its severity for the level, and keeps the raw cause — see [`observability`](../../packages/observability/docs/reference/logger.md).

---

## Step 25.5 — Copy for email

The worker is the only process that reads the `email` namespace, and it is now the only process
that sends at all: every message in this system is a job on `QueueName.MAIL`, and `MailConsumer`
is what renders it and hands it to SMTP.

**`apps/worker/src/consumer/mail.consumer.ts`**

```ts
public async handle(job: Job<MailJobData>): Promise<void> {
  switch (job.name) {
    case "send": {
      const receipt = await this.container.mail.send.execute(SystemPrincipal.platform(), {
        template: job.data.template,
        to: job.data.to,
        locale: job.data.locale as never,
        params: job.data.params,
      });

      this.container.logger.emit("mail.delivery.sent", {
        template: job.data.template,
        messageId: receipt.messageId ?? "",
      });
      return;
    }
    default:
      throw new Error(`Unknown mail job: ${job.name}`);
  }
}
```

**The rate limiter is a worker option, never a use-case concern.** A provider's cap belongs to
this queue and to nothing else, so one `limiter` here is what keeps it out of every caller as a
sleep — `WORKER_MAIL_RATE_PER_MINUTE`, defaulting to 600.

**It does not catch.** BullMQ's retry is driven by rejection, so a `try` here would turn a provider
outage into permanent, silent loss. `mail.delivery.failed` is emitted from the `failed` listener
and only on the last attempt, which with no delivery table is the one place a permanently
undelivered message is reported.

**One `Translator`, one interpolation implementation, one place a typo gets fixed.** A separate
templating system for email is the standard way to end up with two copies of every string and a
locale that is correct in the UI and English in the inbox. The container hands every process a
`StaticContentSource(SERVER_CATALOG)` ([17](17-composition-container.md)) — the only catalog that
carries `email` at all — and `ContentMailRenderer` reads it.

**The recipient's locale rides the job**, so a per-recipient message is a second `Translator`
lookup rather than a second system. `users.locale` is where it comes from, which is why
`AuthMailer` takes a recipient rather than an address.

> [!NOTE]
> `DigestComposer` used to live in a `notification/` folder beside `consumer/`, and was
> constructed only by its own spec. It is deleted: the digest returns in Phase 3 of
> [`plans/archive/COMMUNICATION-PLAN.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/plans/archive/COMMUNICATION-PLAN.md) as a real schedule with a real
> consumer, and a class with no caller is worse documentation than its absence.

> [!IMPORTANT]
> **Rendering per recipient is cheap. Resolving permissions per recipient is not.**
>
> A digest is permission-filtered — each person sees the tasks and goals they may see. Written the
> obvious way, a hundred thousand recipients means a hundred thousand capability resolutions and a
> hundred thousand query sets, and the job runs for hours.
>
> **Group recipients by capability shape, run the queries once per group, and personalise at
> render.** Most organizations have a handful of distinct shapes — everyone on the same goals with
> the same role resolves to the same permitted set — so the expensive half collapses to tens of
> queries while the cheap half stays per person.
>
> ```
> recipients → group by capability shape → one query set per group
>                                        → render per recipient (locale, name, counts)
> ```
>
> This is one of the three paths worth load-testing at 10× before launch, and it fails in a way that
> is invisible at development scale: with fifty seed users the naive version finishes instantly
> ([Data and scale](../opinions/data-and-scale.md) §6).

> The `["email"]` request still comes back with `common` and `error` in it, because
> `ContentSource` adds the shell to every request ([20](20-content-package.md)). An escalation
> notice that needs `error.conflict` already has it.

---

## Step 25.6 — Schedules

**`apps/worker/src/schedule/cleanup.schedule.ts`** registers a BullMQ repeatable job:

```ts
await queue.add(
  "cleanup",
  {},
  {
    repeat: { pattern: "0 3 * * *" },
    jobId: "cleanup-daily",
    removeOnComplete: 10,
    removeOnFail: 100,
  },
);
```

**The fixed `jobId` makes registration idempotent.** Booting the worker three times registers one schedule, not three. Without it, every deploy adds another copy and your nightly job runs eleven times by Friday.

### The two schedule rules

**1. Idempotent by construction.** A repeatable job will run twice — during a deploy overlap, after a Redis failover, whenever a worker is killed mid-job and BullMQ re-delivers. Design the *use-case* so a second run is a no-op: `UPDATE ... WHERE status = 'pending'` rather than `UPDATE ... SET count = count + 1`.

**2. Record before you send.** Anything with an external side effect — an email, a webhook, a payment — writes its "sent" row in the same transaction that decides to send, and checks that row first. Sending and then recording means a crash between the two sends it again on retry.

**Never run cron in the web process.** Two web instances means every schedule fires twice, and nothing in the code will tell you.

### The schedules this kit ships with

Each one exists because something else in the architecture assumed it would.

| Schedule | Queue | Pattern | Why it exists |
|---|---|---|---|
| `cleanup-daily` | maintenance | `0 3 * * *` | Expired sessions, stale verification rows, and lapsed invitations |
| `partitions-monthly` | maintenance | `0 2 1 * *` | Creates the next few months of `activity_log` partitions |
| `archive-monthly` | maintenance | `0 4 1 * *` | Detaches the month that aged out, ships it to S3, records it |
| `analytics-projection` | analytics | `*/5 * * * *` | Replays `activity_log` into the derived store |
| `analytics-reconcile` | analytics | `0 5 * * *` | Compares derived row counts against the activity log |

**The last two register only when `container.hasProjector` is true** — that is, only when
`CLICKHOUSE_URL` is set. The rest always do.

That branch is the whole point. A schedule with no consumer accumulates jobs silently, which is what
left `cleanup-daily` broken for a while. A consumer with no *store* is worse: it succeeds silently, so
five minutes of nothing looks exactly like five minutes of work, and the first sign is a report that
comes out wrong months later. **Absent beats no-op.**

**The invitation half of `cleanup-daily` is not housekeeping.** `invitations_email_uq` is on
`(organization_id, email)`, so an invitation that lapsed last month keeps that address un-invitable
— and the symptom is a re-invite refused with a conflict, which nobody connects to an expired row.
The predicate is indexed (`invitations_expires_idx`), because a nightly delete filtering on an
unindexed column scans every invitation in the deployment to find the few that lapsed.

**`partitions-monthly` runs several months ahead, not one.** A partitioned table with no partition for the current date rejects every insert — so the failure mode of running exactly one month ahead is a total write outage at midnight on the first, and the fix is a job that was supposed to have run. `MaintenanceConsumer.MONTHS_PER_RUN` is 3: each run creates the current month and the next two, so the job can miss two runs before anything breaks. The constant is named for the count rather than the runway, because it was `MONTHS_AHEAD` for a while and read as three months of headroom it never had.

**Sweeping uploads is not in `cleanup-daily`.** `MaintenanceGateway.sweepExpired` takes sessions and verification rows and nothing else — an orphaned S3 object has no row to sweep from, so finding one means listing the bucket against the table, which is a different job with a different cost. Adding it is a method on the gateway and a line in `MaintenanceConsumer.cleanup`.

**Session expiry is a `DELETE`, and that is the whole reason `sessions` is not partitioned.** `DELETE FROM sessions WHERE expires_at < now()` on the index from [16](16-auth-package.md) keeps the table small, which is what partitioning would have bought — without fighting Better Auth's lookup pattern ([Data and scale](../opinions/data-and-scale.md) §4.2).

**A recovery sweep would reconcile against Postgres, never against BullMQ.** A queued job is the one thing in the system that is derived from nothing — a `FLUSHALL`, a crash between enqueue and persist, or a handler that swallowed an error all lose work with no trace. The sweep asks *which domain rows should have been processed and have not been*, which catches all three. It cannot ask BullMQ, because completed jobs age out after an hour and failures after a day ([15](15-infrastructure-package.md)), long before a nightly run.

This is what makes rule 1 above load-bearing rather than good practice: **the sweep re-enqueues work that may well have already been done.** A handler that is not idempotent turns a recovery mechanism into a duplicate-notification incident.

**`analytics-projection` is where the derived store comes from, and it holds no cursor of its own.**
It asks the destination what its last row was, walks `activity_log` forward in keyset batches on
`(occurred_at, id)`, and stops when a batch comes back short. A checkpoint kept beside the store — in
Postgres, in Redis — can disagree with what actually landed, and the disagreement is silent.

Batches are 5,000 rows and a run is capped at 20 of them. ClickHouse merges on write, so a thousand
single-row inserts create a thousand parts the background merge never catches up with; the run cap
bounds how long one job holds a Postgres connection, and the checkpoint means the next tick resumes
exactly where this one stopped.

**`analytics-reconcile` is how a dead consumer gets noticed.** The realistic failure for a derived
store is not an outage — it is a projection that died quietly on a Tuesday and a quarterly report that
looks wrong in March. It asks both stores for per-day row counts over the last week and diffs them;
neither store reaches into the other, which is what keeps each adapter single-store. Today is excluded
because it is still being written to, and a check that cries wolf daily is a check nobody reads.

Drift is repaired by replaying, never by writing to the analytics store directly — that is what keeps
it derived. It logs at **error**, one line per drifting day, because every number a dashboard has
shown since that day is wrong and the replay only works while `activity_log` still covers the window.
**The alert has a deadline attached.**

> [!NOTE]
> **The recovery sweep is the one schedule described here with no file**, which is why it is absent
> from the table above rather than listed as shipping. The gap is deliberate: nothing publishes the
> kind of job it would re-enqueue yet. The reasoning stands for whenever the first one lands.

> [!NOTE]
> **`EmbeddingConsumer` has a producer.** `document.index` publishes to `QueueName.EMBEDDING` from
> `QueueDocumentIndexUseCase`, so the consumer waits on a queue something fills — it spent a while
> waiting on one nothing did. The dedup key is `<organizationId>_<documentId>`, and the separator is
> load-bearing: **BullMQ rejects a `jobId` containing `:`** at publish time, which surfaces as a 500
> rather than as a validation error.

---

## Step 25.7 — Bootstrap and entrypoint

**`apps/worker/src/bootstrap/worker-bootstrap.ts`**

```ts
export class WorkerBootstrap {
  private readonly workers: Worker[] = [];
  private draining: Promise<void> | null = null;

  public constructor(
    private readonly container: Container,
    private readonly redis: RedisConnection,
  ) {}

  public async start(): Promise<void> {
    this.workers.push(
      new EmbeddingConsumer(this.container, this.redis.queueClient(), Env.embeddingConcurrency)
        .start(),
    );

    // Before the schedules register, so an entry that fires the instant it lands has
    // somewhere to run.
    this.workers.push(
      new MaintenanceConsumer(this.container, this.redis.queueClient(), Env.maintenanceConcurrency)
        .start(),
    );

    // Without a ClickHouse config no consumer starts and no schedule registers.
    if (this.container.hasProjector) {
      this.workers.push(
        new AnalyticsConsumer(this.container, this.redis.queueClient(), Env.analyticsConcurrency)
          .start(),
      );
    }

    await new PartitionsSchedule(this.container, this.redis.queueClient()).register();
    await new CleanupSchedule(this.container, this.redis.queueClient()).register();
    await new ArchiveSchedule(this.container, this.redis.queueClient()).register();

    if (this.container.hasProjector) {
      await new ProjectionSchedule(this.container, this.redis.queueClient()).register();
      await new ReconcileSchedule(this.container, this.redis.queueClient()).register();
    }

    this.container.logger.emit("process.started", {
      service: "worker",
      consumers: this.workers.length,
    });
  }

  // Idempotent, and a second signal *joins* the drain already running. Returning
  // early resolves at once, and `main.ts` exits on that — mid-close.
  public stop(signal: string): Promise<void> {
    this.draining ??= this.drain(signal);
    return this.draining;
  }

  private async drain(signal: string): Promise<void> {
    this.container.logger.emit("process.stopping", { service: "worker", signal });
    const startedAt = this.container.clock.now();

    // Handled before the race, never after: once the timeout has won, a rejection
    // arriving late has nowhere to land but `unhandledRejection`.
    const closed = Promise.all(this.workers.map((w) => w.close())).then(
      () => undefined,
      (error: unknown) => {
        this.container.logger.failure(error, { service: "worker", phase: "close" });
      },
    );

    // `close()` drains; the race is the backstop, because a job that never returns
    // must not hold the process past the platform's SIGKILL timer.
    await Promise.race([closed, WorkerBootstrap.after(Env.shutdownTimeoutMs)]);

    await this.redis.close();

    this.container.logger.emit("process.stopped", {
      service: "worker",
      durationMs: this.container.clock.now().getTime() - startedAt.getTime(),
    });

    // Last, because everything closing above it may have had something to say.
    await this.container.dispose();
  }

  private static after(ms: number): Promise<void> {
    return new Promise((resolve) => {
      // Unreferenced, so a pending timer cannot keep the loop alive once every
      // worker has drained.
      setTimeout(resolve, ms).unref();
    });
  }
}
```

> [!IMPORTANT]
> **Three things in `stop()` are each a separate incident when left out.**
>
> - **The `draining` memo, and the fact that it is *returned*.** A container platform that sends `SIGTERM` and then `SIGINT` calls this twice: without a guard the second `close()` on an already-closed client rejects with nothing to catch it, and with a guard that returns nothing the second caller gets a promise that is already resolved — `main.ts` chains `process.exit(0)` onto it and cuts the first drain short. Both halves are one line, and only together are they a guard.
> - **The rejection handler on `closed`, attached before the race rather than after.** When the timeout wins, the drain moves on and the `close()` promise is still pending; a rejection landing afterwards has no handler, reaches `unhandledRejection`, and exits 1 over a shutdown that had already emitted `process.stopped`.
> - **The race against `WORKER_SHUTDOWN_TIMEOUT_MS`.** `close()` drains, and a job that never returns drains forever — past the platform's own SIGKILL timer, which then kills the process in the state graceful shutdown existed to avoid.
> - **`container.clock.now()` on both sides of the duration, never `Date.now()`.** The clock is a port precisely so a test can freeze it; mixing the two makes the one number the shutdown emits untestable.

> [!IMPORTANT]
> **Use `RedisConnection` from [15](15-infrastructure-package.md), not a bare `{ host, port }`.** BullMQ accepts either, but `queueClient()` is what applies `maxRetriesPerRequest: null` and omits the cache key prefix — the two settings BullMQ requires. A plain `{ host, port }` gets ioredis defaults, and the symptom is workers that stop consuming after a few minutes with no error.
>
> The worker builds **its own** `RedisConnection` rather than reaching into the container's, which keeps `Container.redis` private and gives consuming and publishing independent connections. Close it in `stop()`, before disposing the container.

**`apps/worker/src/main.ts`**

```ts
import { Container, RedisConnection } from "./import.js";
import { WorkerBootstrap } from "./bootstrap/index.js";
import { Env } from "./env.js";

const config = Env.containerConfig();
const container = new Container(config);

const redis = new RedisConnection({
  cacheUrl: config.redis.cacheUrl,
  queueUrl: config.redis.queueUrl,
});

const bootstrap = new WorkerBootstrap(container, redis);

// Before `start()`, so a throw during boot lands in the same log stream as one
// during work. Node's default handler prints a stack no collector can key on.
process.on("unhandledRejection", (reason: unknown) => {
  container.logger.failure(reason, { service: "worker", phase: "unhandledRejection" });
  process.exit(1);
});

process.on("uncaughtException", (error: unknown) => {
  container.logger.failure(error, { service: "worker", phase: "uncaughtException" });
  process.exit(1);
});

// Started but not yet awaited, so the handlers below exist while boot is still
// running. A signal in that window drains instead of killing a half-built worker.
const started = bootstrap.start();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void started
      // Boot first: there is nothing to drain until the consumers are registered.
      .then(() => bootstrap.stop(signal))
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        // Logged, never swallowed: a bare `.catch(() => process.exit(1))` turns
        // every shutdown failure into an exit code and nothing else.
        container.logger.failure(error, { service: "worker", signal });
        process.exit(1);
      });
  });
}

try {
  await started;
} catch (error: unknown) {
  container.logger.failure(error, { service: "worker", phase: "start" });
  process.exit(1);
}
```

**`start()` is called, then the signal handlers are registered, and only then is it awaited.** Registering them after the `await` leaves a window — the whole of boot — in which `SIGTERM` gets Node's default handling and kills a worker that has consumers running and schedules half registered. Splitting the promise from the `await` closes it in three lines, and the handler waits on `started` before draining because there is nothing to drain until the consumers exist.

**The two process-level handlers are registered before `start()`, not after.** A container that fails to reach Postgres throws during boot, and without them Node prints a raw stack to stderr — unparseable by the collector, so the one failure you most need in the log stream is the one that misses it. The same reasoning puts a `try` around `start()` and a `.catch` on `stop()`.

**Graceful shutdown is not optional for a worker.** `worker.close()` waits for in-flight jobs to finish before disconnecting. Killing the process mid-job leaves it stalled until BullMQ's lock expires — up to 30 seconds of a job that looks running and is not.

**Top-level `await` works** because the package is ESM and the tsconfig targets ES2024 under `NodeNext` resolution.

---

## Step 25.8 — Run it

```bash
pnpm dev:worker
```

Then, from `psql` or a scratch script, enqueue a job and watch the log. A round trip that ends with a row in `document_chunks` proves the whole chain: env → container → queue → consumer → use-case → port → adapter → Postgres.

---

## ✅ Gate

- `pnpm dev:worker` boots and emits one line of JSON: `{"level":"info","event":"process.started","service":"worker","consumers":2}` — or `3` with `CLICKHOUSE_URL` set.
- `SIGTERM` emits `process.stopping` before draining, and `process.stopped` after.
- `grep -rn "console\." apps/worker/src` returns nothing — Biome's `noConsole` ([05](05-lint-and-format.md)) fails the build otherwise.
- Enqueuing an embedding job produces a row in `document_chunks`.
- `SIGTERM` drains in-flight jobs before exiting.
- Restarting the worker three times leaves exactly **one** repeatable `cleanup-daily` entry (`redis-cli --scan --pattern 'bull:*repeat*'`).
- `apps/worker/src/env.ts` is the only file in the app reading `process.env`.

Do not proceed until this passes.

---

[← `apps/web`](24-web-app.md) · [Hygiene and CI →](26-hygiene-and-ci.md)
