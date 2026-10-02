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
  StubSessionResolver,
} from "./fake/index.js";
// `TestHarness.clock` is one, so a consumer naming that type needs it — and a spec that
// wants a different instant replaces it rather than reaching for `@loadbearing/core`.
// The check `/api/internal/job` runs on a dispatcher delivery. Re-exported so the web app
// verifies with the same code the publisher signs with, without naming infrastructure.
export { FixedClock, JobSignatureHasher } from "./import.js";
export { OrganizationShardingStrategy } from "./shard/index.js";
