import { ServerOnly } from "./import.js";

ServerOnly.assert("@loadbearing/composition");

export {
  ConsumerRegistry,
  EmbeddingConsumer,
  MailConsumer,
  MaintenanceConsumer,
  NotificationConsumer,
  OutboxConsumer,
  QueueConsumer,
  type QueueJob,
  SystemPrincipal,
} from "./consumer/index.js";
export {
  Container,
  type ContainerConfig,
  type HealthReport,
  TestContainer,
  type TestHarness,
  type TestPorts,
} from "./container/index.js";
// The fakes ship beside the harness, because `TestContainer.build()` hands back abstract
// types: a spec constructs the fake it wants to assert on and passes it in.
export {
  DirectUnitOfWork,
  type EnsuredPartitions,
  InMemoryCacheStore,
  InMemoryFlagRepository,
  InMemoryOrganizationReader,
  InMemoryOutboxGateway,
  InMemoryPlatformPolicyRepository,
  InMemoryRateLimitStore,
  InMemoryShardResolver,
  InMemoryStorageGateway,
  InMemoryStoragePolicyGateway,
  InMemoryVectorStore,
  type PublishedEvent,
  type PublishedFrame,
  type PublishedJob,
  type PublishedMail,
  type RecordedActivity,
  RecordingActivityLogger,
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
  StubRepositoryProvider,
  StubSessionResolver,
} from "./fake/index.js";
// `FixedClock` is `TestHarness.clock`'s type. `JobSignatureHasher` lets `/api/internal/job`
// verify with the publisher's own code without the web app naming infrastructure.
export { FixedClock, JobSignatureHasher } from "./import.js";
export { OrganizationShardingStrategy } from "./shard/index.js";
