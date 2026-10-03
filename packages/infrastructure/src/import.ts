// Everything this package takes from outside itself. No relative re-exports, which is
// what keeps it cycle-free.

// ── node ─────────────────────────────────────────────────────────────────────
export { AsyncLocalStorage } from "node:async_hooks";
export { Buffer } from "node:buffer";
export { spawn } from "node:child_process";
export {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createSign,
  type Hash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export { once } from "node:events";
export { Readable } from "node:stream";
export { pipeline } from "node:stream/promises";
export { createGunzip, createGzip, gunzipSync } from "node:zlib";

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
  type ActivityLogger,
  type ActivityPage,
  type ActivityQuery,
  type ActivityReader,
  type AdjustmentInput,
  type AdjustmentRecord,
  type AiSettingsRecord,
  type AiSettingsRepository,
  type ApiKeyPage,
  type ApiKeyRecord,
  type ApiKeyRepository,
  type ApiKeySummary,
  type ArchivedObject,
  type ArchivedPartition,
  CacheStore,
  type CancellationSignal,
  type CancelSignal,
  type CapabilityExplanation,
  type CapabilityRepository,
  CapabilityResolution,
  ChatProvider,
  type ChatRequest,
  type CommentRecord,
  type CommentRepository,
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
  type DocRendering,
  type DocRevisionRecord,
  type DocRevisionSummaryRecord,
  DocRules,
  type DocSearchMatch,
  type DocSpaceFields,
  type DocSpaceRecord,
  type DocSpaceRepository,
  type DocSpaceSummary,
  type DocStalePageRecord,
  type DocumentChunk,
  type DomainEventPublisher,
  type EmailMessage,
  type EmailReceipt,
  EmailSender,
  EmbeddingProvider,
  type EmbeddingPurpose,
  type EntitlementRepository,
  type ExportedObject,
  type FindingKey,
  type FlagRecord,
  type FlagRepository,
  type FlagTarget,
  type GithubInstallationRecord,
  type GithubInstallationRepository,
  GraphArchive,
  type GraphViewRecord,
  type GraphViewRepository,
  type IndexedSource,
  type InvitationLinkPage,
  type InvitationLinkRecord,
  type InvitationLinkRepository,
  type InvitationPage,
  type InvitationRecord,
  type InvitationRepository,
  type JobOptions,
  type LifecycleRule,
  type MaintenanceGateway,
  MarkdownRenderer,
  type MemberDomainPage,
  type MemberDomainRecord,
  type MemberDomainRepository,
  MemberDomainRules,
  type MemberPage,
  type MemberRecord,
  type MemberRepository,
  type ModuleSwitchRecord,
  type NewApiKey,
  type NewDocGrant,
  type NewDocPage,
  type NewInvitation,
  type NewInvitationLink,
  type NewNotification,
  type NewRepository,
  type NewScan,
  type NotificationPage,
  type NotificationPreferenceRepository,
  type NotificationRecipientReader,
  type NotificationRecord,
  type NotificationRepository,
  type OrganizationReader,
  type OrganizationRecord,
  type OrganizationRepository,
  type OutboxGateway,
  type OverrideInput,
  PartitionArchiveGateway,
  type PartitionEstimate,
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
  Principal,
  type ProjectFields,
  type ProjectGrantRecord,
  type ProjectRecord,
  type ProjectRepository,
  ProjectRules,
  type ProviderInstallation,
  type ProviderRepository,
  type QueuedJob,
  QueueName,
  QueuePublisher,
  RateLimitStore,
  type ReachMember,
  type ReachSource,
  type RealtimeChannel,
  RealtimeChannels,
  type RealtimePublisher,
  RealtimeSubscriber,
  type Recipient,
  type RelayedActivity,
  type RelayedActivityStore,
  type RenderedMarkdown,
  type RenderedSection,
  RepositoryProvider,
  type RepositoryRecord,
  type RolePage,
  type RoleRecord,
  type RoleRepository,
  type ScanRecord,
  type ScanRef,
  ScanRefs,
  type ScanRepository,
  ScanRunner,
  ScanTokens,
  type SearchHit,
  SecretCipher,
  Shard,
  type ShardKey,
  type ShardMapReader,
  type ShardPlacement,
  ShardResolver,
  type ShardTenant,
  type StaleChunk,
  StorageGateway,
  StoragePolicyGateway,
  type StoredObject,
  type SubscribeOptions,
  type SweepOutcome,
  type SweptScan,
  TablePlacement,
  type TeamMemberRecord,
  type TeamPage,
  type TeamRecord,
  type TeamRepository,
  type TenantExport,
  type TenantRecord,
  type TenantRepository,
  type TenantRunway,
  type TrackingProject,
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
  type CommentId,
  type CommentTarget,
  type DocAccessRuleDto,
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
  type DomainId,
  type GoalId,
  GraphContract,
  type GraphDocument,
  type GraphViewId,
  Identifiers,
  type InvitationId,
  type InvitationLinkId,
  type KeysetQuery,
  type NotificationCategory,
  type NotificationId,
  type NotificationKind,
  type OrganizationId,
  type PaginationQuery,
  type ProjectGrantId,
  type ProjectId,
  type ProjectRole,
  RealtimeContract,
  type RealtimeMessage,
  type RepositoryId,
  type RoleId,
  type ScanCounts,
  type ScanId,
  type ScanState,
  type ScanTrigger,
  type TeamId,
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
