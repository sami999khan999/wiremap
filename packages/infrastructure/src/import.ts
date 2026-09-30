// Everything this package takes from outside itself. No relative re-exports, which is
// what keeps it cycle-free.

// ── node ─────────────────────────────────────────────────────────────────────
export { AsyncLocalStorage } from "node:async_hooks";
export { Buffer } from "node:buffer";
export { createHash, type Hash } from "node:crypto";
export { once } from "node:events";
export { Readable } from "node:stream";
export { pipeline } from "node:stream/promises";
export { createGunzip, createGzip } from "node:zlib";

// ── @aws-sdk/client-s3 ───────────────────────────────────────────────────────
export {
  DeleteBucketLifecycleCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  type TransitionStorageClass,
} from "@aws-sdk/client-s3";

// ── @aws-sdk/lib-storage ─────────────────────────────────────────────────────
export { Upload } from "@aws-sdk/lib-storage";

// ── @aws-sdk/s3-request-presigner ────────────────────────────────────────────
export { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── @loadbearing/application ─────────────────────────────────────────────────
export {
  type AccountDeny,
  type AccountMembership,
  type AccountRecord,
  type AccountRepository,
  type ActivityCount,
  type ActivityLogger,
  type ActivityRecord,
  type ActivityReplayReader,
  ActivitySubject,
  type AdjustmentInput,
  type AdjustmentRecord,
  type AnalyticsProjector,
  type AnalyticsReader,
  type ApiKeyPage,
  type ApiKeyRecord,
  type ApiKeyRepository,
  type ApiKeySummary,
  type ArchivedObject,
  type ArchivedPartition,
  CacheStore,
  type CancellationSignal,
  type CapabilityExplanation,
  type CapabilityRepository,
  CapabilityResolution,
  ColdArchiveReader,
  type ColdPage,
  type ColdTier,
  type DailyCount,
  type DeletedTenantSweep,
  type DocDraftFields,
  type DocGrantee,
  type DocGrantRecord,
  type DocGrantRepository,
  type DocPageDraftRecord,
  type DocPageNodeRecord,
  type DocPagePublishedRecord,
  type DocPageRepository,
  type DocPublication,
  type DocRevisionRecord,
  type DocRevisionSummaryRecord,
  type DocSearchMatch,
  type DocSpaceFields,
  type DocSpaceRecord,
  type DocSpaceRepository,
  type DocSpaceSummary,
  type DocumentChunk,
  type DomainEventPublisher,
  type EmailMessage,
  type EmailReceipt,
  EmailSender,
  EmbeddingProvider,
  type EntitlementRepository,
  type ExportedObject,
  type FlagRecord,
  type FlagRepository,
  type FlagTarget,
  type IndexedSource,
  type InvitationPage,
  type InvitationRecord,
  type InvitationRepository,
  type JobOptions,
  type LifecycleRule,
  type LogEntry,
  type LogQuery,
  LogReader,
  type MaintenanceGateway,
  // A value: the unified adapter extends it.
  MarkdownRenderer,
  type MemberPage,
  type MemberRecord,
  type MemberRepository,
  type ModuleSwitchRecord,
  type NewApiKey,
  type NewDocGrant,
  type NewDocPage,
  type NewInvitation,
  type NewNotification,
  type NotificationPage,
  type NotificationPreferenceRepository,
  type NotificationRecipientReader,
  type NotificationRecord,
  type NotificationRepository,
  type OrganizationReader,
  type OutboxGateway,
  type OverrideInput,
  type PartitionArchiveEntry,
  PartitionArchiveGateway,
  type PartitionEstimate,
  // A value, not a type: the seed and the maintenance gateway both walk the allowlist.
  PartitionedTable,
  type PartitionedTableEntry,
  type PartitionedTableName,
  type PermissionOverrideRecord,
  type PermissionOverrideRepository,
  type Placement,
  type PlanInput,
  type PlanRecord,
  type PlatformOrganization,
  type PlatformPolicyRecord,
  type PlatformPolicyRepository,
  type PlatformReader,
  type PreferenceRecord,
  // A value, not a type: the founder and the invitation claimer construct one to write
  // an audit row as the tenant being created or joined.
  Principal,
  type ProjectionCheckpoint,
  type ProjectionGap,
  type ProjectionPolicyRecord,
  type ProjectionPolicyRepository,
  type QueuedJob,
  QueuePublisher,
  RateLimitStore,
  type RealtimeChannel,
  RealtimeChannels,
  type RealtimePublisher,
  RealtimeSubscriber,
  type Recipient,
  type RelayedActivity,
  type RelayedActivityStore,
  type RenderedMarkdown,
  type RenderedSection,
  type RestoredMonth,
  type RetentionPolicyRecord,
  type RetentionPolicyRepository,
  type RetentionStore,
  type RolePage,
  type RoleRecord,
  type RoleRepository,
  type SearchHit,
  Shard,
  type ShardAssignment,
  type ShardAssignmentRepository,
  type ShardKey,
  type ShardMapReader,
  type ShardNode,
  type ShardPlacement,
  ShardResolver,
  type ShardTenant,
  type ShardTenantPage,
  StorageGateway,
  StoragePolicyGateway,
  type StoredObject,
  type SubscribeOptions,
  type SweepOutcome,
  // A value: the move gateway treats a `local` table differently from a routed one.
  TablePlacement,
  type TableRowCount,
  type TenantExport,
  TenantMoveGateway,
  type TenantRecord,
  type TenantRepository,
  type TenantRetentionPolicyRecord,
  type TenantRetentionPolicyRepository,
  type TenantRunway,
  type TenantStorageMonth,
  type TenantStoragePage,
  type TenantStorageReader,
  type TenantStorageRow,
  UnitOfWork,
  type UnreadQuery,
  type UserReader,
  type VectorStore,
} from "@loadbearing/application";

// ── @loadbearing/content ─────────────────────────────────────────────────────
// The locale type only. A recipient row carries the language its message will be
// composed in, and `content` sits left of every package that reads one.
export type { Locale } from "@loadbearing/content";

// ── @loadbearing/contracts ───────────────────────────────────────────────────
export {
  type ActivityAction,
  type ApiKeyId,
  type DocGrantKind,
  type DocNavNodeDto,
  type DocPageId,
  type DocPageKind,
  type DocSpaceAudience,
  type DocSpaceId,
  type DocTocEntryDto,
  type DomainEvent,
  type DomainEventInput,
  type DomainEventName,
  type GoalId,
  Identifiers,
  type InvitationId,
  type KeysetQuery,
  type NotificationCategory,
  type NotificationId,
  type NotificationKind,
  type OrganizationId,
  type PaginationQuery,
  RealtimeContract,
  type RealtimeMessage,
  type RoleId,
  type UserId,
} from "@loadbearing/contracts";

// ── @loadbearing/core ────────────────────────────────────────────────────────
export { type Clock, ServerOnly, Token, Uuid } from "@loadbearing/core";

// ── @loadbearing/errors ──────────────────────────────────────────────────────
export {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  UnavailableError,
  ValidationError,
} from "@loadbearing/errors";

// ── @loadbearing/observability ───────────────────────────────────────────────
export { Logger } from "@loadbearing/observability";

// ── @loadbearing/permissions ─────────────────────────────────────────────────
export {
  CapabilitySet,
  type CapabilitySetDto,
  EntitlementMask,
  type PermissionKey,
  PermissionRegistry,
  type ScopedSetDto,
} from "@loadbearing/permissions";

// ── bullmq ───────────────────────────────────────────────────────────────────
export { Queue } from "bullmq";

// ── drizzle-orm ──────────────────────────────────────────────────────────────
export {
  and,
  asc,
  cosineDistance,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  type Logger as DrizzleLogger,
  lt,
  lte,
  ne,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
export { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
export { migrate } from "drizzle-orm/node-postgres/migrator";
export {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// ── hast · mdast (types only) ────────────────────────────────────────────────
export type { Element as HastElement, Nodes as HastNodes, Root as HastRoot } from "hast";
// ── hast-util-to-string ──────────────────────────────────────────────────────
export { toString as hastToString } from "hast-util-to-string";
// ── ioredis ──────────────────────────────────────────────────────────────────
export { Redis, type RedisOptions } from "ioredis";
export type { Nodes as MdastNodes, Root as MdastRoot } from "mdast";

// ── nodemailer ───────────────────────────────────────────────────────────────
// Its types ship separately and are pinned to the same major: a `@types/nodemailer` a
// major behind describes a `sendMail` that is *almost* the one being called.
export { createTransport, type Transporter } from "nodemailer";

// ── pg ───────────────────────────────────────────────────────────────────────
export { Pool } from "pg";

// ── rehype · remark · unified ────────────────────────────────────────────────
// The doc renderer's pipeline. Named here once, so a swap of Markdown library is this
// block and `src/unified/`, and nothing else.
export { default as rehypeHighlight } from "rehype-highlight";
export {
  default as rehypeSanitize,
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
export { default as rehypeSlug } from "rehype-slug";
export { default as rehypeStringify } from "rehype-stringify";
export { default as remarkDirective } from "remark-directive";
export { default as remarkGfm } from "remark-gfm";
export { default as remarkParse } from "remark-parse";
export { default as remarkRehype } from "remark-rehype";
export { unified } from "unified";
export { visit } from "unist-util-visit";
