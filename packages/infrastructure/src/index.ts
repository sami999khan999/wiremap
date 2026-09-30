import { ServerOnly } from "./import.js";

ServerOnly.assert("@loadbearing/infrastructure");

// One folder per external system, so `ls src/` answers "what does this depend on?". A
// folder says the seam is implemented, not that the container is started.
export { BullMqQueuePublisher } from "./bullmq/index.js";
export { type LokiConfig, LokiLogReader } from "./loki/index.js";
export { type OpenAiEmbeddingConfig, OpenAiEmbeddingProvider } from "./openai/index.js";
export {
  BaseRepository,
  Database,
  DatabaseCluster,
  type DatabaseConfig,
  type DatabaseStats,
  type DrizzleClient,
  KeysetCursor,
  type OpenTransaction,
  PgAccountRepository,
  PgActivityLogger,
  PgApiKeyRepository,
  PgBootstrapMembershipEnroller,
  PgCapabilityRepository,
  PgDocGrantRepository,
  PgDocPageRepository,
  PgDocSpaceRepository,
  PgEntitlementRepository,
  PgFlagRepository,
  PgInvitationClaimer,
  PgInvitationRepository,
  PgMaintenanceGateway,
  PgMemberRepository,
  PgMembershipReader,
  PgNotificationPreferenceRepository,
  PgNotificationRecipientReader,
  PgNotificationRepository,
  PgOrganizationFounder,
  PgOrganizationReader,
  PgOutboxGateway,
  PgOutboxPublisher,
  PgPartitionArchiveGateway,
  PgPermissionOverrideRepository,
  PgPersonalOrganizationEnroller,
  PgPlatformPolicyRepository,
  PgPlatformReader,
  PgRetentionPolicyRepository,
  PgRoleRepository,
  PgShardAssignmentRepository,
  PgShardMapReader,
  PgShardResolver,
  PgTenantMoveGateway,
  PgTenantRepository,
  PgTenantRetentionPolicyRepository,
  PgUnitOfWork,
  type PgUnitOfWorkConfig,
  PgUserReader,
  PgVectorStore,
  type PlacedShard,
  type ReplicaHealth,
  type ShardConfig,
  ShardScope,
  TransactionScope,
} from "./pg/index.js";
export {
  RedisCacheStore,
  type RedisConfig,
  RedisConnection,
  RedisRateLimitStore,
  type RedisRealtimeConfig,
  RedisRealtimePublisher,
  RedisRealtimeSubscriber,
  type RedisRole,
} from "./redis/index.js";
export {
  OrdinalCursor,
  S3ColdArchiveReader,
  type S3Config,
  S3StorageGateway,
  S3StoragePolicyGateway,
  StorageKey,
} from "./s3/index.js";
export { type SmtpConfig, SmtpEmailSender } from "./smtp/index.js";
export { UnifiedMarkdownRenderer } from "./unified/index.js";
