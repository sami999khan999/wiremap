# 17 · `@loadbearing/composition`

> The hand-written DI root that replaces a framework container. Roughly a hundred lines, no decorators, no reflection, no module graph.

**Delivers:** One `Container` class constructed identically by the web app and the worker.

**Prerequisite:** [16 · `@loadbearing/auth`](16-auth-package.md)

---

## What this package is for

It is the only package that knows both the abstract ports and their concrete implementations, because wiring them together is its entire job. Every other package knows one side or the other.

That is also why it is the only place a swap happens. Moving from pgvector to Qdrant, from MinIO to S3, from Better Auth to something else — each is one line here, and nothing upstream notices.

```
packages/composition/src/
├── index.ts                        ← ServerOnly.assert(). Two exports, and no more
├── import.ts                       ← every external symbol, both sides of every seam
├── container/
│   ├── index.ts
│   ├── container.config.ts         → ContainerConfig
│   ├── container.ts                → Container
│   └── test-container.ts           → TestContainer, TestPorts   (off the barrel)
└── fake/
    ├── index.ts
    └── …                           one fake per port in `application/src/port/`
```

**`src/` holds `index.ts`, `import.ts`, and folders** — the rule from
[Folders](../opinions/folders.md), which also lists `composition` as role-organised. `container/`
holds one subject's worth of files and `container/container.ts` stutters; accept it, the same way
`content/src/translator/translator.ts` does.

**`import.ts` here is the longest in the repository**, and that is the package working: naming a port
and the class behind it exactly once is the entire deliverable.

---

## Step 17.1 — `ContainerConfig`

**`packages/composition/src/container/container.config.ts`**

```ts
export interface ContainerConfig {
  readonly database: {
    readonly url: string;
    readonly maxConnections?: number;
    // Node 0 is `url` above; this is every node after it, in index order.
    // Empty is one node, which is every deployment until the split.
    readonly shards?: readonly { readonly url: string; readonly directUrl: string }[];
  };
  readonly redis: {
    // Two instances, different durability. Neither is optional: a missing
    // queueUrl silently puts jobs on the instance that evicts them.
    readonly cacheUrl: string;
    readonly queueUrl: string;
  };
  readonly storage: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly forcePathStyle: boolean;
  };
  readonly auth: {
    readonly secret: string;
    readonly baseUrl: string;
    readonly trustedOrigins: readonly string[];
    readonly sessionMaxAgeSeconds: number;
    readonly cookieCacheMaxAgeSeconds: number;
    readonly requireEmailVerification: boolean;
  };
  readonly embedding: {
    readonly apiKey: string;
    readonly model: string;
    readonly dimensions: number;
  };
  readonly logging: {
    readonly level: LogLevel;
    // Human-shaped output for a terminal. Never true in production — Alloy wants
    // one JSON object per line and nothing else.
    readonly pretty: boolean;
    // Two of the four log labels. Low-cardinality by construction.
    readonly app: string;
    readonly env: string;
  };
}
```

**Every value the system needs, in one shape, and none of it read from the environment.** `apps/web/src/env.ts` and `apps/worker/src/env.ts` are the only two files in the repository that touch `process.env`; they parse it, validate it, and hand this object down.

That is what lets you construct the entire system in a test with a fake database and a frozen clock — and it is what lets the same code run in a web server and a background worker without either fighting over environment variables. (The Tauri desktop app never constructs a `Container` at all — see [30](30-desktop-app.md).)

> [!WARNING]
> **`auth` is required here and [25](25-worker-app.md) asks for it to be optional.** That is a real
> open decision, not an oversight, and it is worth reading both sides before you pick. The worker
> never issues or validates a session, so handing it an `AUTH_SECRET` is one more secret in one more
> environment for no reason. But making the block optional puts `| undefined` on `auth`, `sessions`
> and `principals` — three fields the web app uses at four call sites where the value is never
> actually absent, so the type would be lying in the direction of noise.
>
> Build it required, as written here. Decide when you reach [25](25-worker-app.md), where the worker's
> constraints are concrete: either the block goes optional and the three fields become
> possibly-undefined, or the worker's `env.ts` supplies a block it does not use. Whichever you pick,
> the other document needs the same edit.

---

## Step 17.2 — `Container`

**`packages/composition/src/container/container.ts`**

```ts
import { ServerOnly, SystemClock, type Clock } from "@loadbearing/core";
import { JsonLogger, type LogLevel, type Logger } from "@loadbearing/observability";
import {
  type ActivityLogger,
  Authorizer,
  type CacheStore,
  type EmbeddingProvider,
  type QueuePublisher,
  type SessionResolver,
  type StorageGateway,
  type UnitOfWork,
  type VectorStore,
} from "@loadbearing/application";
import {
  ApiKeyResolver,
  AuthFactory,
  BetterAuthSessionResolver,
  CapabilityCache,
  type AuthInstance,
  MembershipReader,
  PrincipalBuilder,
} from "@loadbearing/auth";
import { ContentSource, StaticContentSource } from "@loadbearing/content";
import {
  Database,
  PgActivityLogger,
  PgApiKeyRepository,
  PgCapabilityRepository,
  PgMembershipReader,
  PgUnitOfWork,
  PgVectorStore,
  TransactionScope,
  BullMqQueuePublisher,
  OpenAiEmbeddingProvider,
  RedisCacheStore,
  RedisConnection,
  S3StorageGateway,
} from "@loadbearing/infrastructure";
import type { ContainerConfig } from "./container.config.js";

ServerOnly.assert("@loadbearing/composition");

export class Container {
  // ── infrastructure, private ───────────────────────────────
  private readonly database: Database;
  private readonly redis: RedisConnection;
  private readonly queuePublisher: BullMqQueuePublisher;
  private readonly transactions: TransactionScope;

  // ── shared primitives ─────────────────────────────────────
  public readonly clock: Clock;
  public readonly authorizer: Authorizer;
  public readonly logger: Logger;

  // ── ports, exposed as their abstract types ────────────────
  public readonly cache: CacheStore;
  public readonly storage: StorageGateway;
  public readonly queue: QueuePublisher;
  public readonly vectors: VectorStore;
  public readonly embeddings: EmbeddingProvider;
  public readonly sessions: SessionResolver;
  public readonly activity: ActivityLogger;
  public readonly unitOfWork: UnitOfWork;
  public readonly content: ContentSource;

  // ── auth ──────────────────────────────────────────────────
  public readonly auth: AuthInstance;
  public readonly capabilities: CapabilityCache;
  public readonly principals: PrincipalBuilder;

  // ── use-cases go here as features arrive ──────────────────
  // public readonly reactivateTask: ReactivateTaskUseCase;

  constructor(private readonly config: ContainerConfig) {
    this.database = new Database(config.database);
    this.redis = new RedisConnection({
      cacheUrl: config.redis.cacheUrl,
      queueUrl: config.redis.queueUrl,
    });
    this.transactions = new TransactionScope();

    // First, so a failure in anything below it has somewhere to be recorded.
    // `app` and `env` are bound rather than passed through: they belong on every
    // line, and `JsonLoggerOptions` has no field of its own for either.
    this.logger = new JsonLogger({
      level: config.logging.level,
      pretty: config.logging.pretty,
      bound: { app: config.logging.app, env: config.logging.env },
    });

    this.clock = new SystemClock();
    this.authorizer = new Authorizer();

    this.cache = new RedisCacheStore(this.redis.client());
    this.storage = new S3StorageGateway(config.storage);
    this.queuePublisher = new BullMqQueuePublisher(this.redis.queueClient());
    this.queue = this.queuePublisher;
    this.unitOfWork = new PgUnitOfWork(this.database, this.transactions);

    // ── the two swap points ──
    this.vectors = new PgVectorStore(this.database, this.transactions);
    this.embeddings = new OpenAiEmbeddingProvider(config.embedding);

    // No argument until `SERVER_CATALOG` exists — the constructor already defaults to
    // the client catalog, and a server catalog identical to it would enforce nothing (20).
    this.content = new StaticContentSource();

    // The fourth argument is what pins a tenant onto every session at sign-in. It is
    // the one place `PgMembershipReader` is bound to the `MembershipReader` port that
    // `auth` declares — `infrastructure` cannot implement it nominally, because `auth`
    // already depends on it, so this line is where a signature drift is caught.
    const membershipReader: MembershipReader = new PgMembershipReader(
      this.database,
      this.transactions,
    );
    this.auth = AuthFactory.create(config.auth, this.database, this.cache, membershipReader);
    this.sessions = new BetterAuthSessionResolver(this.auth);

    const capabilityRepository = new PgCapabilityRepository(this.database, this.transactions);
    this.capabilities = new CapabilityCache(capabilityRepository, this.cache);

    const apiKeyRepository = new PgApiKeyRepository(this.database, this.transactions);
    const apiKeyResolver = new ApiKeyResolver(apiKeyRepository, this.capabilities);
    this.principals = new PrincipalBuilder(this.sessions, apiKeyResolver, this.capabilities);

    // Shares the transaction scope, which is what makes the audit row commit
    // with the state change rather than beside it.
    this.activity = new PgActivityLogger(this.database, this.transactions, this.clock);

    // ── use-cases, as features arrive ──
    // this.reactivateTask = new ReactivateTaskUseCase(
    //   new PgTaskRepository(this.database, this.transactions),
    //   this.authorizer,
    //   this.activity,
    //   this.clock,
    // );
  }

  // Postgres and both Redis instances. A cache that is down degrades; a queue
  // that is down silently stops accepting work, which is worth knowing about.
  public async healthy(): Promise<boolean> {
    const [database, cache, queue] = await Promise.all([
      this.database.isHealthy(),
      this.redis.healthy("cache"),
      this.redis.healthy("queue"),
    ]);
    return database && cache && queue;
  }

  public async dispose(): Promise<void> {
    await this.queuePublisher.close();
    await this.redis.close();
    await this.database.close();
  }
}
```

---

## Four rules for this class

**1. Ports are exposed as their abstract types.** `public readonly vectors: VectorStore`, not `PgVectorStore`. If the concrete type leaks into the public surface, a consumer eventually calls a Postgres-specific method and the swap stops being one line. The annotation is what enforces it.

**2. Never build request-scoped state into the container.** The `Principal` is passed as an argument to `execute()`, never held here. One container per **process**, not per request. Letting per-request state into the DI root couples you to a lifecycle model, and both the worker and any future NestJS migration become expensive.

**3. Config arrives as a constructor argument.** No `process.env` in this file or in any package. The two `env.ts` files are the boundary, and Biome's `noProcessEnv` rule from [05](05-lint-and-format.md) is what keeps it true.

**The logger's `app` and `env` are bound fields, not options.** `JsonLoggerOptions` declares `level`, `pretty`, `sink`, `bound`, `clock` and `random` — and nothing else. Spreading `config.logging` into it would compile, because excess-property checking does not apply to a variable, and both values would be silently dropped: no error, no label, and a log platform that cannot tell `web` from `worker`.

Binding them puts `app` and `env` on every line, which is what lets the Alloy pipeline read all four labels out of the JSON body rather than inferring two of them from container metadata that differs between Compose, Kubernetes, and a host-run `pnpm dev` ([11](11-local-infrastructure.md)). The application knows what it is; the orchestrator's name for the process is incidental.

**4. `dispose()` closes in reverse construction order.** Queues before the Redis connections before Postgres. Closing Redis while BullMQ still holds blocking connections produces a hang on shutdown that looks like a deadlock, because it is one.

`RedisConnection.close()` quits both instances, which is why they sit behind one object rather than as two fields on the container. Two fields is two things to remember at every shutdown path, and the one that gets forgotten is the queue — where an unclean close means in-flight jobs are redelivered rather than completed.

**One Postgres close, and it is last.** The container holds a `DatabaseCluster` rather than a bare
`Database`, and the cluster owns every pool it built — node 0's included. `await this.cluster.close()`
is the whole shutdown of Postgres; closing `database` beside it would close the same pool twice.
`health()` reads the cluster too, and reports `database` as `Record<node, boolean>`: one node is
`{ 0: true }`, and two with one down is the difference between restarting a pod and paging whoever
owns shard 1. The sharding seam itself is
[`packages/infrastructure/docs/reference/sharding.md`](../../packages/infrastructure/docs/reference/sharding.md).

**The logger is constructed first and disposed last**, which is the same rule read from both ends. Constructed first, because a `Database` that cannot reach Postgres should produce a structured line rather than a stack trace on stderr. Disposed last, because everything closing above it may have something to say on the way out.

> [!NOTE]
> **`logger` is a shared primitive, not a port.** It sits with `clock` and `authorizer` rather than in the port block, and there is no `Logger` abstract class in `packages/application/src/port/` — the domain layer does not log at all ([12](12-application-package.md)). The seam lives in `@loadbearing/observability`, low enough in the graph that `infrastructure`, `auth`, and both apps can reach it.

---

> [!NOTE]
> **Every port `application` declares is wired here — all sixteen, no exceptions.** That is a
> property worth checking rather than assuming: read `packages/application/src/port/` against the
> fields on this class and the two lists should line up name for name.
>
> It has not always held. `EventBus` was declared for cross-slice side effects — a finance use-case
> publishing `invoice.approved` rather than importing the notification slice — with no adapter in
> `infrastructure` and no field here. A use-case that published would have published into a
> recording fake under test and into nothing at all in production, which is worse than a missing
> feature: it reads as working. It was deleted; the transactional outbox it was reserving arrived
> later and arrived whole — a port, an adapter and a `Container` line in one change, which is the
> only shape that was ever acceptable.

---

## Step 17.3 — Where use-cases go

A container with fifty use-cases as fields is unwieldy but it is honest, and it is still simpler than a module graph. Two ways to keep it readable as features arrive:

**Group by slice.** One private method per module, returning a small object:

```ts
public readonly task: TaskUseCases;

// …
this.task = this.buildTaskUseCases(activity);

private buildTaskUseCases(activity: ActivityLogger): TaskUseCases {
  const tasks = new PgTaskRepository(this.database);
  return {
    create: new CreateTaskUseCase(tasks, this.authorizer, activity),
    reactivate: new ReactivateTaskUseCase(tasks, this.authorizer, activity, this.clock),
  };
}
```

The oRPC router then reads `context.container.task.reactivate.execute(...)`, which mirrors the contract path exactly.

**Do not add lazy instantiation.** The temptation is a `get reactivateTask()` that constructs on first access. It saves microseconds at boot and costs you the property that a container which constructs successfully is a container where every dependency resolved. Eager construction means a wiring mistake is a startup crash rather than a request-time surprise at 3am.

---

## Step 17.4 — Testing with a container

The reason this class exists in this shape:

**`packages/composition/src/container/test-container.ts`**

```ts
// One entry per port in `application/src/port/`. Adding a port there is one line here
// and a compile error until it is written — which is the whole reason this file is in
// `src/` and not in a spec: it is checked by `tsc`, not by a test that runs.
export interface TestPorts {
  readonly activity: ActivityLogger;
  readonly cache: CacheStore;
  readonly content: ContentSource;
  readonly embeddings: EmbeddingProvider;
  readonly queue: QueuePublisher;
  readonly sessions: SessionResolver;
  readonly storage: StorageGateway;
  readonly unitOfWork: UnitOfWork;
  readonly vectors: VectorStore;
}

// The ports plus the three shared primitives a use-case is constructed with. No `auth`,
// no `principals`, no `capabilities`: a use-case test never authenticates.
export interface TestHarness extends TestPorts {
  readonly clock: FixedClock;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
}

export class TestContainer {
  private static readonly EPOCH = "2026-01-01T00:00:00Z";

  private constructor() {}

  public static build(overrides: Partial<TestPorts> = {}): TestHarness {
    return {
      clock: new FixedClock(new Date(TestContainer.EPOCH)),
      logger: new SilentLogger(),
      authorizer: new Authorizer(),

      activity: overrides.activity ?? new RecordingActivityLogger(),
      cache: overrides.cache ?? new InMemoryCacheStore(),
      // Already in-memory: its catalog is a map of dynamic imports, so there is nothing
      // to fake. The one port whose real implementation is the test double.
      content: overrides.content ?? new StaticContentSource(),
      embeddings: overrides.embeddings ?? new StubEmbeddingProvider(),
      queue: overrides.queue ?? new RecordingQueuePublisher(),
      sessions: overrides.sessions ?? new StubSessionResolver(),
      storage: overrides.storage ?? new InMemoryStorageGateway(),
      unitOfWork: overrides.unitOfWork ?? new DirectUnitOfWork(),
      vectors: overrides.vectors ?? new InMemoryVectorStore(),
    };
  }
}
```

A use-case spec then builds the repository itself — repository ports live in their slice, not in
`port/` ([12](12-application-package.md)) — and takes the rest from the harness:

```ts
const activity = new RecordingActivityLogger();
const harness = TestContainer.build({ activity });
const tasks = new InMemoryTaskRepository();

await new ReactivateTaskUseCase(tasks, harness.authorizer, activity, harness.clock)
  .execute(principal, { taskId });

expect(activity.actions()).toEqual(["task.reactivated"]);
```

No Postgres, no Redis, no S3, no Better Auth, no HTTP. Every use-case test builds a `Principal` directly with a hand-made `CapabilitySet` and asserts on behaviour. Integration tests — the ones that need real infrastructure — are then reserved for the adapters themselves and the auth routes, which is a much smaller and much less flaky set.

**A fake for every port, including the ones a given test does not use.** `StubEmbeddingProvider` returns a fixed vector; that is enough, and it means adding a port to `application` shows up here as one line rather than as a compile error in forty specs. A fake elaborate enough to need its own tests would defeat that. `tests/container/test-container.spec.ts` counts the port directory rather than restating the list, so a port added without a double fails the run.

**Two of them carry real logic anyway, and both earn it.** `InMemoryVectorStore` computes actual cosine, because a fake that scored every hit identically would let *"the top result is the right one"* pass either way — the one assertion a retrieval use-case is worth testing. And `RecordingQueuePublisher` honours `jobId` deduplication, because "enqueue OCR for this receipt, once" is a business rule the use-case is responsible for, not queue configuration.

**Query counts belong in that integration set.** A fake repository cannot tell you that `resolveFor` became 3 + N queries — only a real adapter against a real database can. That is the assertion [13](13-infrastructure-postgres.md) adds next to the repository, and it is the reason the integration tier exists at all rather than being a slower copy of the unit tier.

---

## Step 17.5 — The barrel

**`packages/composition/src/index.ts`**

```ts
import { ServerOnly } from "./import.js";

ServerOnly.assert("@loadbearing/composition");

export { Container, type ContainerConfig } from "./container/index.js";
```

**`TestContainer` is not exported.** Leaving it off the barrel is the difference between "test
helper" and "public API" — a distinction `export *` could not have made.

**It lives in `src/`, not `tests/`, and that is the point.** `TestPorts` has one entry per abstract
class in `packages/application/src/port/`, so adding an eleventh port there stops this file
compiling until it has a double. That is a `tsc` check rather than a spec's, which is the only way
the claim above — *"one line here rather than a compile error in forty specs"* — actually holds.
`tsup` builds from `src/index.ts`, which names neither `test-container.ts` nor `fake/`, so nothing
reaches `dist/`:

```bash
grep -c "TestContainer\|InMemory\|Recording\|Stub" packages/composition/dist/index.js
```

Returns `0`.

**`build()` returns the ports as their abstract types** — the one place this repository does the
*opposite* of rule 1, for the same underlying reason. `harness.activity.recorded()` deliberately does
not compile: a spec asserting on a fake should own the reference, so the assertion reads off a
variable the test already declared rather than a chain into a container.

```ts
const activity = new RecordingActivityLogger();
const harness = TestContainer.build({ activity });
// …
expect(activity.actions()).toEqual(["task.reactivated"]);
```

That is also why `src/fake/` has a barrel and `TestContainer` does not go on the package's.

---

## ✅ Gate

```bash
pnpm --filter @loadbearing/composition build
```

```bash
grep -rn "process\.env" packages --include=*.ts | grep -vE "\.config\.ts|src/(migrate|seed|smoke|tables)/"
```

Returns **nothing**. No package reads its own configuration.

The four exempted directories are exactly the ones Biome's `noProcessEnv` override lists
([05](05-lint-and-format.md)) — build-time entry points, not shipped code. Keep the two lists in
step: a path exempted in one and not the other is a gate that passes while the rule is broken, or a
build that fails for no reason.

Every public field on `Container` that is a port is annotated with an abstract type, not a concrete class.

Do not proceed until this passes.

---

[← `@loadbearing/auth`](16-auth-package.md) · [`@loadbearing/api-client` →](18-api-client-package.md)
