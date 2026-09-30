import {
  DirectUnitOfWork,
  InMemoryCacheStore,
  InMemoryOrganizationReader,
  InMemoryOutboxGateway,
  InMemoryRateLimitStore,
  InMemoryRealtimeHub,
  InMemoryRealtimeSubscriber,
  InMemoryShardResolver,
  InMemoryStorageGateway,
  InMemoryStoragePolicyGateway,
  InMemoryTenantMembershipReader,
  InMemoryUserReader,
  InMemoryVectorStore,
  RecordingActivityLogger,
  RecordingCapabilityInvalidator,
  RecordingDomainEventPublisher,
  RecordingEmailSender,
  RecordingMailPublisher,
  RecordingMaintenanceGateway,
  RecordingPartitionArchiveGateway,
  RecordingQueuePublisher,
  RecordingRealtimePublisher,
  RecordingRelayedActivityStore,
  RecordingSessionGateway,
  StubEmbeddingProvider,
  StubMailRenderer,
  StubMarkdownRenderer,
  StubSessionResolver,
} from "../fake/index.js";
import {
  type ActivityLogger,
  Authorizer,
  type CacheStore,
  type CapabilityInvalidator,
  type ContentSource,
  type DomainEventPublisher,
  type EmailSender,
  type EmbeddingProvider,
  FixedClock,
  type Logger,
  type MailPublisher,
  type MailRenderer,
  type MaintenanceGateway,
  type MarkdownRenderer,
  type OrganizationReader,
  type OutboxGateway,
  type PartitionArchiveGateway,
  type Principal,
  type QueuePublisher,
  type RateLimitStore,
  type RealtimePublisher,
  type RealtimeSubscriber,
  type RelayedActivityStore,
  SERVER_CATALOG,
  type SessionGateway,
  type SessionResolver,
  type ShardingStrategy,
  type ShardResolver,
  SilentLogger,
  StaticContentSource,
  type StorageGateway,
  type StoragePolicyGateway,
  type TenantMembershipReader,
  type UnitOfWork,
  type UserReader,
  type VectorStore,
} from "../import.js";
import { OrganizationShardingStrategy } from "../shard/index.js";

// One entry per port. In `src/` rather than a spec so `tsc` checks it: adding a port is
// a compile error here until it is written.
export interface TestPorts {
  readonly activity: ActivityLogger;
  readonly relayedActivity: RelayedActivityStore;
  readonly cache: CacheStore;
  readonly rateLimits: RateLimitStore;
  readonly capabilities: CapabilityInvalidator;
  readonly content: ContentSource;
  readonly events: DomainEventPublisher;
  readonly email: EmailSender;
  readonly embeddings: EmbeddingProvider;
  readonly mailPublisher: MailPublisher;
  readonly mailRenderer: MailRenderer;
  readonly markdownRenderer: MarkdownRenderer;
  readonly maintenance: MaintenanceGateway;
  readonly organizations: OrganizationReader;
  readonly outbox: OutboxGateway;
  readonly partitionArchive: PartitionArchiveGateway;
  readonly realtime: RealtimePublisher;
  readonly realtimeSubscriber: RealtimeSubscriber;
  readonly queue: QueuePublisher;
  readonly sessions: SessionResolver;
  readonly signOuts: SessionGateway;
  readonly shardResolver: ShardResolver;
  readonly sharding: ShardingStrategy;
  readonly storage: StorageGateway;
  readonly storagePolicy: StoragePolicyGateway;
  readonly tenantMemberships: TenantMembershipReader;
  readonly unitOfWork: UnitOfWork;
  readonly users: UserReader;
  readonly vectors: VectorStore;
}

// The ports plus the three shared primitives. No auth: a use-case test builds a
// `Principal` directly and never authenticates.
export interface TestHarness extends TestPorts {
  readonly clock: FixedClock;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  // What a consumer calls to place a job. Every fake here is in memory and consults
  // no shard, so this runs the work — a spec asserting placement uses a real scope.
  readonly placed: <T>(principal: Principal, work: () => Promise<T>) => Promise<T>;
  // The cross-tenant sweep's loop. One node here, which is what an in-memory fake is:
  // a spec asserting the loop runs per node builds a real cluster.
  readonly eachShard: (work: (node: number) => Promise<void>) => Promise<void>;
}

export class TestContainer {
  // Frozen, and the same instant in every spec. A test that needs time to pass calls
  // `clock.advance()`, which returns a new clock rather than mutating this one.
  private static readonly EPOCH = "2026-01-01T00:00:00Z";

  private constructor() {}

  // Ports come back as abstract types on purpose: construct the fake, keep the
  // reference, pass it in, and assert off the variable the spec already owns.
  public static build(overrides: Partial<TestPorts> = {}): TestHarness {
    return {
      clock: new FixedClock(new Date(TestContainer.EPOCH)),
      logger: new SilentLogger(),
      authorizer: new Authorizer(),
      placed: (_principal, work) => work(),
      eachShard: (work) => work(0),

      activity: overrides.activity ?? new RecordingActivityLogger(),
      relayedActivity: overrides.relayedActivity ?? new RecordingRelayedActivityStore(),
      cache: overrides.cache ?? new InMemoryCacheStore(),
      rateLimits: overrides.rateLimits ?? new InMemoryRateLimitStore(),
      capabilities: overrides.capabilities ?? new RecordingCapabilityInvalidator(),
      // The one port whose real implementation is the test double, and `SERVER_CATALOG`
      // like `Container`: the client default carries no `email` namespace.
      content: overrides.content ?? new StaticContentSource(SERVER_CATALOG),
      email: overrides.email ?? new RecordingEmailSender(),
      events: overrides.events ?? new RecordingDomainEventPublisher(),
      embeddings: overrides.embeddings ?? new StubEmbeddingProvider(),
      mailPublisher: overrides.mailPublisher ?? new RecordingMailPublisher(),
      mailRenderer: overrides.mailRenderer ?? new StubMailRenderer(),
      markdownRenderer: overrides.markdownRenderer ?? new StubMarkdownRenderer(),
      maintenance: overrides.maintenance ?? new RecordingMaintenanceGateway(),
      organizations: overrides.organizations ?? new InMemoryOrganizationReader(),
      outbox: overrides.outbox ?? new InMemoryOutboxGateway(),
      partitionArchive: overrides.partitionArchive ?? new RecordingPartitionArchiveGateway(),
      // Deliberately not connected to each other. A spec that wants a published frame to
      // arrive builds one `InMemoryRealtimeHub` and passes both fakes over it.
      realtime: overrides.realtime ?? new RecordingRealtimePublisher(),
      realtimeSubscriber:
        overrides.realtimeSubscriber ?? new InMemoryRealtimeSubscriber(new InMemoryRealtimeHub()),
      queue: overrides.queue ?? new RecordingQueuePublisher(),
      sessions: overrides.sessions ?? new StubSessionResolver(),
      signOuts: overrides.signOuts ?? new RecordingSessionGateway(),
      shardResolver: overrides.shardResolver ?? new InMemoryShardResolver(),
      sharding: overrides.sharding ?? new OrganizationShardingStrategy(),
      storage: overrides.storage ?? new InMemoryStorageGateway(),
      storagePolicy: overrides.storagePolicy ?? new InMemoryStoragePolicyGateway(),
      tenantMemberships: overrides.tenantMemberships ?? new InMemoryTenantMembershipReader(),
      unitOfWork: overrides.unitOfWork ?? new DirectUnitOfWork(),
      users: overrides.users ?? new InMemoryUserReader(),
      vectors: overrides.vectors ?? new InMemoryVectorStore(),
    };
  }
}
