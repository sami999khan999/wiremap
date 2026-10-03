import {
  type ActivityLogger,
  ActivityRelaySubscriber,
  AddMemberDomainUseCase,
  AddTeamMemberUseCase,
  AdjustEntitlementUseCase,
  ApiKeyResolver,
  AssignPlanUseCase,
  AuthFactory,
  type AuthInstance,
  Authorizer,
  BetterAuthSessionGateway,
  BetterAuthSessionResolver,
  BindGithubInstallationUseCase,
  BullMqQueuePublisher,
  type CacheStore,
  CapabilityCache,
  CapabilitySet,
  ChangeMemberRoleUseCase,
  CheckoutScanUseCase,
  ClearAccountDenyUseCase,
  ClearEntitlementAdjustmentUseCase,
  ClearPermissionOverrideUseCase,
  type Clock,
  CloudflareQueuePublisher,
  CompleteScanUseCase,
  type ContentSource,
  CountUnreadNotificationsUseCase,
  CreateApiKeyUseCase,
  CreateDocPageUseCase,
  CreateDocSpaceUseCase,
  CreateInvitationLinkUseCase,
  CreateProjectUseCase,
  CreateRoleUseCase,
  CreateScanUploadUseCase,
  CreateTeamUseCase,
  type Database,
  DatabaseCluster,
  type DatabaseStats,
  DeleteDocPageUseCase,
  DeleteDocSpaceUseCase,
  DeleteOrganizationUseCase,
  DeletePlanUseCase,
  DeleteRoleUseCase,
  DeliverNotificationUseCase,
  DenyAccountPermissionUseCase,
  DenyPermissionOverrideUseCase,
  DispatchScanUseCase,
  DocAccess,
  DocCache,
  DocFeaturePolicy,
  DocImageSweep,
  DocRerender,
  DocSearch,
  DocTree,
  type DomainEventPublisher,
  DomainJoiningEnroller,
  type EmailSender,
  ExpireEntitlementAdjustmentsUseCase,
  ExpirePermissionOverridesUseCase,
  ExportOrganizationUseCase,
  FailScanUseCase,
  FindAccountUseCase,
  FlagCache,
  GeminiEmbeddingProvider,
  GetDocPageUseCase,
  GetDocRevisionUseCase,
  GetDocSpaceUseCase,
  GetEntitlementUseCase,
  GetGithubStatusUseCase,
  GetGraphUseCase,
  GetNotificationPreferencesUseCase,
  GetOrganizationEntitlementUseCase,
  GetOrganizationUseCase,
  GetProjectAccessOverviewUseCase,
  GetProjectUseCase,
  GithubActionsScanRunner,
  GithubAppProvider,
  type GithubInstallationRepository,
  GrantPermissionOverrideUseCase,
  GrantPermissionUseCase,
  HandleGithubWebhookUseCase,
  HmacScanTokens,
  IndexDocumentUseCase,
  InspectEffectivePermissionsUseCase,
  InspectPlatformStatusUseCase,
  type InvitationClaimer,
  InvitationClaimingEnroller,
  InviteMemberUseCase,
  JsonLogger,
  ListActivityUseCase,
  ListApiKeysUseCase,
  ListAvailableRepositoriesUseCase,
  ListDocAccessOptionsUseCase,
  ListDocGrantsUseCase,
  ListDocPagesUseCase,
  ListDocRevisionsUseCase,
  ListDocSpacesUseCase,
  ListFlagsUseCase,
  ListInvitationLinksUseCase,
  ListInvitationsUseCase,
  ListMemberDomainsUseCase,
  ListMembersUseCase,
  ListModuleSwitchesUseCase,
  ListNotificationsUseCase,
  ListPermissionOverridesUseCase,
  ListPlansUseCase,
  ListPlatformDocSpacesUseCase,
  ListProjectsUseCase,
  ListRolesUseCase,
  ListScansUseCase,
  ListTeamMembersUseCase,
  ListTeamsUseCase,
  ListTenantExportsUseCase,
  LocalScanRunner,
  type Logger,
  type MailPublisher,
  type MailRenderer,
  type MaintenanceGateway,
  ManageProjectAccessUseCase,
  ManageProjectRepositoryUseCase,
  ManageViewsUseCase,
  MarkAllNotificationsReadUseCase,
  type MarkdownRenderer,
  MarkNotificationReadUseCase,
  type MemberDomainClaimer,
  MemberRealtimeSubscriber,
  type MembershipEnroller,
  type MembershipReader,
  MoveDocPageUseCase,
  NotificationSubscriber,
  NullMembershipEnroller,
  NullRepositoryProvider,
  NullScanRunner,
  OpenAiEmbeddingProvider,
  OpenDocImageUseCase,
  type OrganizationFounder,
  type OrganizationId,
  type OrganizationReader,
  type OutboxGateway,
  type PartitionArchiveGateway,
  PgAccountRepository,
  PgActivityLogger,
  PgActivityReader,
  PgApiKeyRepository,
  PgBootstrapMembershipEnroller,
  PgCapabilityRepository,
  PgDocGrantRepository,
  PgDocPageRepository,
  PgDocSpaceRepository,
  PgEntitlementRepository,
  PgFlagRepository,
  PgGithubInstallationRepository,
  PgGraphViewRepository,
  PgInvitationClaimer,
  PgInvitationLinkClaimer,
  PgInvitationLinkRepository,
  PgInvitationRepository,
  PgMaintenanceGateway,
  PgMemberDomainClaimer,
  PgMemberDomainRepository,
  PgMemberRepository,
  PgMembershipReader,
  PgNotificationPreferenceRepository,
  PgNotificationRecipientReader,
  PgNotificationRepository,
  PgOrganizationFounder,
  PgOrganizationReader,
  PgOrganizationRepository,
  PgOutboxGateway,
  PgOutboxPublisher,
  PgPartitionArchiveGateway,
  PgPermissionOverrideRepository,
  PgPersonalOrganizationEnroller,
  PgPlatformPolicyRepository,
  PgPlatformReader,
  PgProjectRepository,
  PgRoleRepository,
  PgScanRepository,
  PgShardMapReader,
  PgShardResolver,
  PgTeamRepository,
  PgTenantRepository,
  PgUnitOfWork,
  PgUserReader,
  PgVectorStore,
  type PlatformPolicyRepository,
  type PlatformReader,
  PreviewDocPageUseCase,
  Principal,
  PrincipalBuilder,
  type ProjectRepository,
  PublishDocPageUseCase,
  PurgeOrganizationUseCase,
  PurgeProjectUseCase,
  QueueDocumentIndexUseCase,
  type QueuePublisher,
  QueueScanUseCase,
  type RateLimitStore,
  ReadDocNavUseCase,
  ReadDocPageUseCase,
  ReadPlatformDocNavUseCase,
  ReadPlatformDocUseCase,
  type RealtimePublisher,
  type RealtimeSubscriber,
  RedisCacheStore,
  RedisConnection,
  RedisRateLimitStore,
  RedisRealtimePublisher,
  RedisRealtimeSubscriber,
  ReembedChunksUseCase,
  ReinstateAccountUseCase,
  type RelayedActivityStore,
  RemoveMemberDomainUseCase,
  RemoveMemberUseCase,
  RemoveOrganizationUseCase,
  RemoveProjectUseCase,
  RemoveTeamMemberUseCase,
  RemoveTeamUseCase,
  type ReplicaHealth,
  type RepositoryProvider,
  ResendInvitationUseCase,
  RestoreDocRevisionUseCase,
  RevokeApiKeyUseCase,
  RevokeDocGrantUseCase,
  RevokeInvitationLinkUseCase,
  RevokeInvitationUseCase,
  RevokePermissionUseCase,
  RunScanUseCase,
  S3StorageGateway,
  S3StoragePolicyGateway,
  SaveDocGrantUseCase,
  SaveDocPageUseCase,
  SavePlanUseCase,
  SERVER_CATALOG,
  SearchDocsUseCase,
  SearchDocumentsUseCase,
  type SearchMode,
  SearchPlatformDocsUseCase,
  SendMailUseCase,
  SendNotificationDigestUseCase,
  type SessionResolver,
  SetMemberActiveUseCase,
  type ShardConfig,
  type ShardingStrategy,
  type ShardResolver,
  ShardScope,
  SmtpEmailSender,
  StaticContentSource,
  type StorageGateway,
  StorageGraphArchive,
  type StoragePolicyGateway,
  SubscriberRegistry,
  SuspendAccountUseCase,
  SweepScansUseCase,
  SwitchModuleUseCase,
  SystemClock,
  type TenantMembershipReader,
  ToggleReplicaReadsUseCase,
  TransactionScope,
  TransferOwnershipUseCase,
  TriggerScanUseCase,
  UnifiedMarkdownRenderer,
  type UnitOfWork,
  UpdateDefaultPlanUseCase,
  UpdateDocSpaceUseCase,
  UpdateFlagTargetUseCase,
  UpdateFlagUseCase,
  UpdateNotificationPreferenceUseCase,
  UpdateOrganizationUseCase,
  UpdateProjectUseCase,
  UpdateRoleUseCase,
  UpdateTeamUseCase,
  UploadDocImageUseCase,
  UploadScanUseCase,
  type UserId,
  type VectorStore,
} from "../import.js";
import {
  ContentMailRenderer,
  QueuedAuthMailer,
  QueuedInvitationMailer,
  QueuedMailPublisher,
} from "../mail/index.js";
import { OutboxDrainPublisher } from "../outbox/index.js";
import { NoopRealtimePublisher } from "../realtime/index.js";
import { OrganizationShardingStrategy } from "../shard/index.js";
import type { ContainerConfig } from "./container.config.js";
import { ContainerHealthReader } from "./container-health.reader.js";

// The API-key slice's use-cases. Grouped like the member ones, and absent for the same
// reason: the worker authenticates nothing and issues nothing.
interface ApiKeyUseCases {
  readonly listApiKeys: ListApiKeysUseCase;
  readonly createApiKey: CreateApiKeyUseCase;
  readonly revokeApiKey: RevokeApiKeyUseCase;
}

// The platform's account use-cases (`AX6.6`). Auth-only, because a suspend ends the
// account's sessions, and only a process with Better Auth holds them.
export interface AccountUseCases {
  readonly findAccount: FindAccountUseCase;
  readonly suspendAccount: SuspendAccountUseCase;
  readonly reinstateAccount: ReinstateAccountUseCase;
  readonly denyAccountPermission: DenyAccountPermissionUseCase;
  readonly clearAccountDeny: ClearAccountDenyUseCase;
}

// The member slice's use-cases. Named so the getter can say what is absent rather than
// handing out `undefined`.
export interface MemberUseCases {
  readonly listMembers: ListMembersUseCase;
  readonly listInvitations: ListInvitationsUseCase;
  readonly inviteMember: InviteMemberUseCase;
  readonly revokeInvitation: RevokeInvitationUseCase;
  // Beside `inviteMember` and not folded into it: a resend issues a new token for a
  // row that exists, and an invite that silently reissued would hide a duplicate.
  readonly resendInvitation: ResendInvitationUseCase;
  readonly changeMemberRole: ChangeMemberRoleUseCase;
  // One use-case behind two procedures: the direction is an argument, because the
  // column is one value and two classes would let them disagree about "active".
  readonly setMemberActive: SetMemberActiveUseCase;
  readonly removeMember: RemoveMemberUseCase;
  readonly listInvitationLinks: ListInvitationLinksUseCase;
  readonly createInvitationLink: CreateInvitationLinkUseCase;
  readonly revokeInvitationLink: RevokeInvitationLinkUseCase;
  readonly listMemberDomains: ListMemberDomainsUseCase;
  readonly addMemberDomain: AddMemberDomainUseCase;
  readonly removeMemberDomain: RemoveMemberDomainUseCase;
}

// One field per dependency the deployment cannot serve requests without, plus the
// roll-up the probe's status code comes from.
export interface HealthReport {
  readonly healthy: boolean;
  // One entry per physical node, keyed by index. A single-node deployment reads
  // `{ 0: true }`, which is the same answer the boolean was and says which node it is.
  readonly database: Readonly<Record<number, boolean>>;
  readonly cache: boolean;
  readonly queue: boolean;
  // `null` when this deployment runs no ClickHouse — absent, rather than passing. Lite
  // runs none, so it is always `null` until analytics is ported back.
  readonly analytics: boolean | null;
  // `null` in a process that has opened no subscriber connection, which is every worker.
  // Not a failure, and not something to open a connection in order to report on.
  readonly realtime: boolean | null;
  // This process's own pool, and only that: a client waiting inside pgBouncer reads as
  // `waiting: 0` here. See docs/scale/pgbouncer.md.
  readonly pool: DatabaseStats;
}

// The only class in the repository that knows both an abstract port and the concrete
// class behind it. That is the entire job, and it is why a swap is one line here.
export class Container {
  // Not configurable: the number that matters is how far behind a reader may fall before
  // a refetch is cheaper than the memory, and it is the same on every deployment.
  private static readonly REALTIME_QUEUE_SIZE = 256;

  // Two consecutive ticks before the first line, so a burst that drains is load rather
  // than an incident — and the pair has to fit inside the connect timeout, see below.
  private static readonly POOL_PROBE_TICKS = 2;
  // A quarter of the connect timeout, so `TICKS` of them is half of it. A fixed window
  // longer than that timeout could never fire — the caller is rejected before tick two.
  private static readonly POOL_PROBE_DIVISOR = 4;
  private static readonly POOL_PROBE_MIN_MS = 250;

  // Thirty minutes. A month of `activity_log` streamed to S3 is the only work in this
  // system that legitimately runs this long, and it holds one connection to do it.
  private static readonly DIRECT_STATEMENT_TIMEOUT_MS = 1_800_000;

  // The worker's reserved system id, reused: an actor column holding a tenant id would read
  // as a user, and a placement-only principal is never an actor anyway.
  private static readonly PLACEMENT_USER_ID = "00000000-0000-7000-8000-000000000001";

  // ── infrastructure, private ───────────────────────────────
  private readonly database: Database;
  private readonly poolProbe: ReturnType<typeof setInterval>;
  private readonly poolProbeMs: number;
  // Consecutive ticks with somebody waiting. Reset the moment the queue clears, so the
  // `forMs` on the line is the length of *this* episode.
  private poolWaitingTicks = 0;
  private readonly redis: RedisConnection;
  private readonly queuePublisher: QueuePublisher & { close(): Promise<void> };
  // Held concretely for the same reason as the two above: `dispose()` needs `close()`,
  // and `EmailSender` is a port that says nothing about a transport's lifetime.
  private readonly emailSender: SmtpEmailSender;
  private readonly transactions: TransactionScope;
  // Established once per request by the middleware and once per job by a consumer.
  private readonly shards: ShardScope;
  private readonly cluster: DatabaseCluster;
  private readonly shardResolver: ShardResolver;
  public readonly sharding: ShardingStrategy;

  // ── shared primitives ─────────────────────────────────────
  public readonly clock: Clock;
  public readonly authorizer: Authorizer;
  public readonly logger: Logger;

  // ── ports, exposed as their abstract types ────────────────
  public readonly cache: CacheStore;
  // The transport's per-procedure counters, in the cache instance: losing them resets a
  // limit, which costs nobody anything (`CR.6`).
  public readonly rateLimits: RateLimitStore;
  public readonly storage: StorageGateway;
  public readonly queue: QueuePublisher;
  public readonly vectors: VectorStore;
  // How the corpus is embedded and searched, from `EMBEDDING_PROVIDER`. Built once, so no
  // use-case names a vendor or asks which one it was handed.
  public readonly searchMode: SearchMode;
  public readonly activity: ActivityLogger;
  // The same adapter as `activity`, seen through the port the relay subscriber writes to.
  private readonly relayedActivity: RelayedActivityStore;
  // RBAC, members, API keys, the enrollers and the platform screens. The catalog is
  // the last single primary, so this one is always node 0.
  public readonly catalogUnitOfWork: UnitOfWork;
  // Notifications and documents: everything a tenant produces. Opens on
  // whichever node the ambient `ShardScope` names.
  public readonly routedUnitOfWork: UnitOfWork;
  // The partition runway and the outbox drain, which `eachShard` walks node by node.
  // Catalog-placed here meant the loop ran, and every iteration wrote to node 0.
  public readonly localUnitOfWork: UnitOfWork;
  public readonly content: ContentSource;
  // Built unconditionally: a missing mail transport means every sign-up is a dead end.
  public readonly email: EmailSender;
  // Public because Phase 3's notification subscriber holds one. The renderer stays
  // private: only `mail.send` below has any business calling it.
  public readonly mailPublisher: MailPublisher;
  private readonly mailRenderer: MailRenderer;
  // Public because every use-case that publishes takes one, and because the worker's
  // consumer holds the gateway and the registry directly.
  public readonly eventPublisher: DomainEventPublisher;
  public readonly outbox: OutboxGateway;
  public readonly realtime: RealtimePublisher;
  // Public because the web router holds it directly: a stream is the one thing a
  // procedure reads from a port rather than from a use-case.
  public readonly realtimeSubscriber: RealtimeSubscriber;
  public readonly subscribers: SubscriberRegistry;
  // No principal, because it owns no tenant's rows. Reachable only from the worker's
  // schedules, never from a request path.
  public readonly maintenance: MaintenanceGateway;
  // The one read in this system that is cross-tenant by definition: every per-tenant
  // loop the worker runs starts from it.
  public readonly organizations: OrganizationReader;
  public readonly partitionArchive: PartitionArchiveGateway;

  // ── auth, absent in a process that never authenticates ────
  private readonly authInstance: AuthInstance | undefined;
  private readonly sessionResolver: SessionResolver | undefined;
  private readonly principalBuilder: PrincipalBuilder | undefined;
  public readonly capabilities: CapabilityCache;
  // Which organization is the tier. Read by the capability cache on every RBAC
  // write, and by every platform use-case that records an audit row.
  public readonly platform: PlatformReader;

  // ── membership, built in every process ────────────────────
  // The worker reads none, and building them there costs nothing: none opens a
  // connection until called.
  public readonly memberships: MembershipReader;
  // The same instance under `application`'s port. Two names because the two ports ask
  // the same question in the opposite argument order — see `tenant-membership.reader.ts`.
  public readonly tenantMemberships: TenantMembershipReader;
  public readonly invitationClaimer: InvitationClaimer;
  // Wiremap: a shareable link's claim, and the join page's preview of it.
  public readonly invitationLinkClaimer: PgInvitationLinkClaimer;
  public readonly organization: {
    readonly get: GetOrganizationUseCase;
    readonly update: UpdateOrganizationUseCase;
    readonly transferOwnership: TransferOwnershipUseCase;
    readonly remove: RemoveOrganizationUseCase;
  };
  public readonly teams: {
    readonly list: ListTeamsUseCase;
    readonly members: ListTeamMembersUseCase;
    readonly create: CreateTeamUseCase;
    readonly update: UpdateTeamUseCase;
    readonly remove: RemoveTeamUseCase;
    readonly addMember: AddTeamMemberUseCase;
    readonly removeMember: RemoveTeamMemberUseCase;
  };
  public readonly activityLog: { readonly list: ListActivityUseCase };
  // The code host. `NullRepositoryProvider` when no App is configured.
  public readonly repositoryProvider: RepositoryProvider;
  public readonly projects: {
    readonly list: ListProjectsUseCase;
    readonly get: GetProjectUseCase;
    readonly create: CreateProjectUseCase;
    readonly update: UpdateProjectUseCase;
    readonly remove: RemoveProjectUseCase;
    readonly purge: PurgeProjectUseCase;
    readonly available: ListAvailableRepositoriesUseCase;
    readonly repository: ManageProjectRepositoryUseCase;
    readonly access: ManageProjectAccessUseCase;
    readonly accessOverview: GetProjectAccessOverviewUseCase;
    // Read by the push webhook and the schedule tick, across tenants.
    readonly tracking: ProjectRepository;
  };
  public readonly scans: {
    readonly list: ListScansUseCase;
    readonly run: RunScanUseCase;
    readonly createUpload: CreateScanUploadUseCase;
    readonly graph: GetGraphUseCase;
    readonly checkout: CheckoutScanUseCase;
    readonly upload: UploadScanUseCase;
    readonly complete: CompleteScanUseCase;
    readonly fail: FailScanUseCase;
    readonly dispatch: DispatchScanUseCase;
    readonly trigger: TriggerScanUseCase;
    readonly sweep: SweepScansUseCase;
  };
  public readonly views: ManageViewsUseCase;
  public readonly github: {
    readonly status: GetGithubStatusUseCase;
    readonly bind: BindGithubInstallationUseCase;
    readonly webhook: HandleGithubWebhookUseCase;
    // Read and written by the webhook route, which names an installation and no tenant.
    readonly installations: GithubInstallationRepository;
  };
  public readonly organizationFounder: OrganizationFounder;

  // ── use-cases, one field each, constructed eagerly ────────
  // Grouped by slice so a consumer reads `container.ai.indexDocument`. See
  // docs/reference/container.md.
  public readonly ai: {
    readonly indexDocument: IndexDocumentUseCase;
    readonly queueIndex: QueueDocumentIndexUseCase;
    readonly searchDocuments: SearchDocumentsUseCase;
    readonly reembed: ReembedChunksUseCase;
  };
  // Outside the `auth` block on purpose. The worker is the process that sends mail and it
  // has no auth config — which is exactly what building the old mailer in there got wrong.
  public readonly mail: { readonly send: SendMailUseCase };
  // In every process: the worker delivers and digests, the web tier reads. Neither
  // half needs an auth config, which is why this sits outside that branch too.
  public readonly notification: {
    readonly list: ListNotificationsUseCase;
    readonly countUnread: CountUnreadNotificationsUseCase;
    readonly markRead: MarkNotificationReadUseCase;
    readonly markAllRead: MarkAllNotificationsReadUseCase;
    readonly preferences: GetNotificationPreferencesUseCase;
    readonly updatePreference: UpdateNotificationPreferenceUseCase;
    readonly deliver: DeliverNotificationUseCase;
    readonly sendDigest: SendNotificationDigestUseCase;
  };
  // Inside `auth`'s block below, because a key is issued *by* someone: without an auth
  // config there is no principal to be the issuer.
  private readonly apiKeyUseCases: ApiKeyUseCases | undefined;
  private readonly accountUseCases: AccountUseCases | undefined;
  // Named `platformAdmin` rather than `platform`, which is the reader beside it: one is
  // "which organization is the tier" and the other is what an admin may do to it.
  public readonly platformAdmin: {
    readonly deleteOrganization: DeleteOrganizationUseCase;
    // The job half of the delete. Reachable from the worker only — nothing on a
    // request path may run it, which is the whole point of `19.20`.
    readonly purgeOrganization: PurgeOrganizationUseCase;
    readonly exportOrganization: ExportOrganizationUseCase;
    readonly listExports: ListTenantExportsUseCase;
    readonly inspectStatus: InspectPlatformStatusUseCase;
    readonly toggleReplicaReads: ToggleReplicaReadsUseCase;
    readonly listFlags: ListFlagsUseCase;
    readonly listPlans: ListPlansUseCase;
    readonly savePlan: SavePlanUseCase;
    readonly deletePlan: DeletePlanUseCase;
    readonly updateDefaultPlan: UpdateDefaultPlanUseCase;
    readonly organizationEntitlement: GetOrganizationEntitlementUseCase;
    readonly assignPlan: AssignPlanUseCase;
    readonly adjustEntitlement: AdjustEntitlementUseCase;
    readonly clearAdjustment: ClearEntitlementAdjustmentUseCase;
    // The worker's nightly sweep. Reachable from the worker only, like `purgeOrganization`.
    readonly expireAdjustments: ExpireEntitlementAdjustmentsUseCase;
    readonly moduleSwitches: ListModuleSwitchesUseCase;
    readonly switchModule: SwitchModuleUseCase;
    readonly updateFlag: UpdateFlagUseCase;
    readonly updateFlagTarget: UpdateFlagTargetUseCase;
  };
  // Bucket-shaped policy, beside the object-shaped `storage`. The worker's daily
  // reconcile is its only reader.
  public readonly storagePolicy: StoragePolicyGateway;
  // One row. An absent row is the defaults, so a deployment that never opens the screen
  // behaves as it always did.
  public readonly platformPolicy: PlatformPolicyRepository;
  // Whether a flag is on for an org. Read by `fetchSession` on every document request,
  // and by a use-case before its permission check when a flag guards it.
  public readonly flags: FlagCache;
  // Docs, the platform's public and granted spaces included: those are the platform
  // organization's own rows, so one slice serves both. See docs/reference/container.md.
  public readonly doc: {
    readonly cache: DocCache;
    readonly listSpaces: ListDocSpacesUseCase;
    readonly getSpace: GetDocSpaceUseCase;
    readonly createSpace: CreateDocSpaceUseCase;
    readonly updateSpace: UpdateDocSpaceUseCase;
    readonly deleteSpace: DeleteDocSpaceUseCase;
    readonly read: ReadDocPageUseCase;
    readonly readNav: ReadDocNavUseCase;
    readonly accessOptions: ListDocAccessOptionsUseCase;
    readonly tree: ListDocPagesUseCase;
    readonly getPage: GetDocPageUseCase;
    readonly createPage: CreateDocPageUseCase;
    readonly savePage: SaveDocPageUseCase;
    readonly publishPage: PublishDocPageUseCase;
    readonly movePage: MoveDocPageUseCase;
    readonly deletePage: DeleteDocPageUseCase;
    readonly previewPage: PreviewDocPageUseCase;
    readonly revisions: ListDocRevisionsUseCase;
    readonly revision: GetDocRevisionUseCase;
    readonly restoreRevision: RestoreDocRevisionUseCase;
    // The platform's public and granted spaces. No principal required, so the caller
    // places them with `placedAt`, at the platform organization's node.
    readonly readPlatform: ReadPlatformDocUseCase;
    readonly readPlatformNav: ReadPlatformDocNavUseCase;
    readonly listPlatformSpaces: ListPlatformDocSpacesUseCase;
    readonly listGrants: ListDocGrantsUseCase;
    readonly saveGrant: SaveDocGrantUseCase;
    readonly revokeGrant: RevokeDocGrantUseCase;
    readonly search: SearchDocsUseCase;
    readonly searchPlatform: SearchPlatformDocsUseCase;
    readonly uploadImage: UploadDocImageUseCase;
    // Like `readPlatform`, it takes no principal of the image's organization, and the
    // caller places it at that organization's node.
    readonly openImage: OpenDocImageUseCase;
    // The worker's, off `pnpm doc:rerender`: every published page an older renderer wrote.
    readonly rerender: DocRerender;
  };
  // One person's exceptions to their role. `expire` is the worker's, like the other sweeps.
  public readonly overrides: {
    readonly list: ListPermissionOverridesUseCase;
    readonly grant: GrantPermissionOverrideUseCase;
    readonly deny: DenyPermissionOverrideUseCase;
    readonly clear: ClearPermissionOverrideUseCase;
    readonly expire: ExpirePermissionOverridesUseCase;
  };
  public readonly rbac: {
    readonly listRoles: ListRolesUseCase;
    readonly inspectEffective: InspectEffectivePermissionsUseCase;
    // The org's ceiling, for the role editor to grey out what the plan does not include.
    readonly entitlement: GetEntitlementUseCase;
    readonly createRole: CreateRoleUseCase;
    readonly updateRole: UpdateRoleUseCase;
    readonly deleteRole: DeleteRoleUseCase;
    readonly grantPermission: GrantPermissionUseCase;
    readonly revokePermission: RevokePermissionUseCase;
  };
  // Only with an auth config: the invitation mail needs `auth.baseUrl` for its link,
  // and the process without one is the worker, which never invites.
  private readonly memberUseCases: MemberUseCases | undefined;

  public constructor(config: ContainerConfig) {
    // First, and now genuinely first: the pool below hands it a listener, and a pool
    // error arriving with nowhere to go is an `uncaughtException` that ends the process.
    this.logger = new JsonLogger({
      level: config.logging.level,
      pretty: config.logging.pretty,
      bound: { app: config.logging.app, env: config.logging.env },
    });

    this.shards = new ShardScope();
    this.transactions = new TransactionScope();
    // Built before the cluster, because the cluster reads through it — and it reads
    // through the cache, which is why neither can be a field initialiser.
    this.shardResolver = new PgShardResolver(
      () => this.cluster.catalog(),
      () => this.cache,
      () => this.logger,
    );

    // **One node unless `DATABASE_SHARD_<n>_URL` says otherwise.** The cluster is the
    // only place in `src/` that opens a pool; everything else asks it for one.
    this.cluster = DatabaseCluster.from(
      [
        {
          pooled: {
            url: config.database.url,
            maxConnections: config.database.poolMax,
            statementTimeoutMs: config.database.statementTimeoutMs,
            idleTimeoutMs: config.database.poolIdleTimeoutMs,
            connectionTimeoutMs: config.database.poolConnectTimeoutMs,
            // The log label, so `pg_stat_activity` names the process holding one.
            applicationName: config.logging.app,
            onError: (error: Error) =>
              this.logger.emit("database.pool.error", { message: error.message }),
          },
          // One connection, and a budget the role floor does not cap: this handle
          // exists for a detach-and-stream that legitimately takes minutes.
          direct: {
            url: config.database.directUrl ?? config.database.url,
            maxConnections: 1,
            statementTimeoutMs: Container.DIRECT_STATEMENT_TIMEOUT_MS,
            applicationName: `${config.logging.app}-direct`,
            onError: (error: Error) =>
              this.logger.emit("database.pool.error", { message: error.message }),
          },
          replica: this.replicaPool(config, config.database.replicaUrl),
        },
        // Nodes 1 and up. Same pool settings as node 0, because a shard is the same
        // database with a different set of tenants on it.
        ...(config.database.shards ?? []).map((shard) => ({
          pooled: {
            url: shard.url,
            maxConnections: config.database.poolMax,
            statementTimeoutMs: config.database.statementTimeoutMs,
            idleTimeoutMs: config.database.poolIdleTimeoutMs,
            connectionTimeoutMs: config.database.poolConnectTimeoutMs,
            applicationName: config.logging.app,
            onError: (error: Error) =>
              this.logger.emit("database.pool.error", { message: error.message }),
          },
          direct: {
            url: shard.directUrl,
            maxConnections: 1,
            statementTimeoutMs: Container.DIRECT_STATEMENT_TIMEOUT_MS,
            applicationName: `${config.logging.app}-direct`,
            onError: (error: Error) =>
              this.logger.emit("database.pool.error", { message: error.message }),
          },
          replica: this.replicaPool(config, shard.replicaUrl),
        })),
      ],
      this.shardResolver,
    );
    // One line, and the fork's swap point: the organization is the shard.
    this.sharding = new OrganizationShardingStrategy();

    this.database = this.cluster.catalog();

    // Unreferenced, so a script that builds a container and finishes is not held open by
    // a timer nobody is reading.
    this.poolProbeMs = Container.probeIntervalFor(config.database.poolConnectTimeoutMs);
    this.poolProbe = setInterval(() => this.probePool(), this.poolProbeMs);
    this.poolProbe.unref();
    this.redis = new RedisConnection({
      cacheUrl: config.redis.cacheUrl,
      queueUrl: config.redis.queueUrl,
      ...(config.redis.realtimeUrl ? { realtimeUrl: config.redis.realtimeUrl } : {}),
    });

    this.clock = new SystemClock();
    this.authorizer = new Authorizer();

    this.cache = new RedisCacheStore(this.redis.client(), this.logger);
    this.rateLimits = new RedisRateLimitStore(this.redis.client());
    this.storage = new S3StorageGateway(config.storage);
    this.storagePolicy = new S3StoragePolicyGateway(config.storage);

    // The *direct* pool, not the shared one: a month-sized detach and stream needs a
    // budget the 30 s role floor will not give it. See docs/scale/pgbouncer.md.
    this.partitionArchive = new PgPartitionArchiveGateway(
      this.cluster,
      this.transactions,
      this.shards,
      this.storage,
    );

    this.queuePublisher =
      config.queue?.driver === "cloudflare"
        ? new CloudflareQueuePublisher(
            { url: config.queue.url, secret: config.queue.secret },
            this.cache,
          )
        : new BullMqQueuePublisher(this.redis.queueClient());
    this.queue = this.queuePublisher;
    // **Two, bound per slice** — decision D16. The port stays `run(work)`, so no
    // use-case knows which one it was handed; a mis-binding fails the first spec.
    this.routedUnitOfWork = new PgUnitOfWork(
      this.cluster,
      this.transactions,
      this.shards,
      "routed",
      {
        statementTimeoutMs: config.database.statementTimeoutMs,
      },
    );
    this.catalogUnitOfWork = new PgUnitOfWork(
      this.cluster,
      this.transactions,
      this.shards,
      "catalog",
      {
        statementTimeoutMs: config.database.statementTimeoutMs,
      },
    );
    // Three, not two: `local` tables exist on every node, and the two passes that walk
    // the cluster have to open their transaction on the node they are walking.
    this.localUnitOfWork = new PgUnitOfWork(this.cluster, this.transactions, this.shards, "local", {
      statementTimeoutMs: config.database.statementTimeoutMs,
    });
    this.maintenance = new PgMaintenanceGateway(
      this.cluster,
      this.transactions,
      this.shards,
      this.localUnitOfWork,
    );
    this.organizations = new PgOrganizationReader(this.cluster, this.transactions, this.shards);

    // ── the swap points ──
    // Each reads a `driver` rather than naming a class: the alternative is named in a
    // switch a compiler checks, not in a document.
    this.vectors = Container.buildVectorStore(config, this.cluster, this.transactions, this.shards);
    this.searchMode = Container.buildSearchMode(config.embedding, this.logger);

    // The only catalog carrying the `email` namespace the worker's digests read. A
    // client bundle cannot reach it.
    this.content = new StaticContentSource(SERVER_CATALOG);
    this.emailSender = new SmtpEmailSender(config.email, this.logger);
    this.email = this.emailSender;
    this.mailPublisher = new QueuedMailPublisher(this.queue, this.logger);
    this.mailRenderer = new ContentMailRenderer(this.content, config.email.baseUrl);
    this.mail = { send: new SendMailUseCase(this.mailRenderer, this.email) };

    const capabilityRepository = new PgCapabilityRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    this.platform = new PgPlatformReader(this.cluster, this.transactions, this.shards);
    this.capabilities = new CapabilityCache(capabilityRepository, this.cache, this.platform);

    // Shares the transaction scope, which is what makes the audit row commit with the
    // state change rather than beside it.
    const activity = new PgActivityLogger(this.cluster, this.transactions, this.shards, this.clock);
    this.activity = activity;
    this.relayedActivity = activity;
    const outboxPublisher = new PgOutboxPublisher(
      this.cluster,
      this.transactions,
      this.shards,
      this.clock,
    );
    // BullMQ drains every second on a schedule; Cloudflare has only an hourly tick, so
    // each write asks for a drain of its own. See docs/reference/container.md.
    this.eventPublisher =
      config.queue?.driver === "cloudflare"
        ? new OutboxDrainPublisher(outboxPublisher, this.queuePublisher, this.logger)
        : outboxPublisher;
    this.outbox = new PgOutboxGateway(this.cluster, this.transactions, this.shards);
    this.realtime =
      config.realtime.driver === "none"
        ? new NoopRealtimePublisher()
        : new RedisRealtimePublisher(this.redis.realtimeClient(), this.logger);
    // The role is resolved on the first `subscribe`, not here, so the worker never holds
    // one — which is what makes `health().realtime` honestly `null`.
    this.realtimeSubscriber = new RedisRealtimeSubscriber(
      () => this.redis.subscriberClient(),
      {
        maxStreamsPerUser: config.realtime.maxStreamsPerUser,
        maxAgeMs: config.realtime.streamMaxAgeSeconds * 1_000,
        queueSize: Container.REALTIME_QUEUE_SIZE,
      },
      () => this.redis.realtimeClient(),
    );

    const notifications = new PgNotificationRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    const notificationPreferences = new PgNotificationPreferenceRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    const notificationRecipients = new PgNotificationRecipientReader(
      this.cluster,
      this.transactions,
      this.shards,
    );

    this.notification = {
      list: new ListNotificationsUseCase(this.authorizer, notifications),
      countUnread: new CountUnreadNotificationsUseCase(this.authorizer, notifications, this.cache),
      markRead: new MarkNotificationReadUseCase(
        this.authorizer,
        notifications,
        this.cache,
        this.clock,
        this.routedUnitOfWork,
      ),
      markAllRead: new MarkAllNotificationsReadUseCase(
        this.authorizer,
        notifications,
        this.cache,
        this.clock,
        this.routedUnitOfWork,
      ),
      preferences: new GetNotificationPreferencesUseCase(this.authorizer, notificationPreferences),
      updatePreference: new UpdateNotificationPreferenceUseCase(
        this.authorizer,
        notificationPreferences,
        this.routedUnitOfWork,
      ),
      deliver: new DeliverNotificationUseCase(
        notifications,
        notificationPreferences,
        notificationRecipients,
        this.mailPublisher,
        this.realtime,
        this.cache,
        this.routedUnitOfWork,
      ),
      sendDigest: new SendNotificationDigestUseCase(
        notifications,
        notificationPreferences,
        notificationRecipients,
        this.mailPublisher,
        this.organizations,
      ),
    };

    // One instance under two ports, and they must never be passed for each other:
    // `auth`'s takes the user first, `application`'s the tenant.
    const memberships = new PgMembershipReader(this.cluster, this.transactions, this.shards);
    this.memberships = memberships;
    this.tenantMemberships = memberships;

    // A frozen list, and the registry rejects a duplicate name or an unknown event at
    // construction — so a wiring mistake is a startup crash rather than a lost event.
    this.subscribers = new SubscriberRegistry([
      // `24.2a`: the logger is also where a relayed audit row is written, on its node.
      new ActivityRelaySubscriber(this.relayedActivity),
      new MemberRealtimeSubscriber(this.realtime),
      new NotificationSubscriber(this.notification.deliver),
    ]);

    // Where `infrastructure`'s adapters bind to the ports `auth` declares. The binding
    // is structural, so these lines are where a signature drift is caught.
    this.organizationFounder = new PgOrganizationFounder(
      this.cluster,
      this.transactions,
      this.shards,
      this.activity,
      this.logger,
    );
    this.invitationClaimer = new PgInvitationClaimer(
      this.cluster,
      this.transactions,
      this.shards,
      this.activity,
      this.eventPublisher,
    );
    this.invitationLinkClaimer = new PgInvitationLinkClaimer(
      this.cluster,
      this.transactions,
      this.shards,
      this.activity,
      this.eventPublisher,
    );
    const domainClaimer = new PgMemberDomainClaimer(
      this.cluster,
      this.transactions,
      this.shards,
      this.activity,
      this.eventPublisher,
    );

    // One instance each: they hold no state beyond the pool and the scope, so a second
    // copy would be a second name.
    const roles = new PgRoleRepository(this.cluster, this.transactions, this.shards);
    const members = new PgMemberRepository(this.cluster, this.transactions, this.shards);
    const invitations = new PgInvitationRepository(this.cluster, this.transactions, this.shards);
    const invitationLinks = new PgInvitationLinkRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    const memberDomains = new PgMemberDomainRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    const teamRepository = new PgTeamRepository(this.cluster, this.transactions, this.shards);

    // Skipped when `config.auth` is absent: `apps/worker` builds a `SystemPrincipal`
    // from a named grant list and never resolves a credential.
    if (config.auth) {
      // The only thing that writes the first `memberships` row, and the only line that
      // knows which mode is bound. See docs/reference/container.md.
      const membershipEnroller: MembershipEnroller = Container.enroller(
        config.auth.enrolmentMode,
        config.auth.bootstrapOrganizationSlug,
        this.cluster,
        this.transactions,
        this.shards,
        this.organizationFounder,
        this.invitationClaimer,
        domainClaimer,
      );

      this.authInstance = AuthFactory.create(
        config.auth,
        this.database,
        this.cache,
        this.memberships,
        membershipEnroller,
        // Copy and transport joined here and nowhere else: `auth` owes no words and
        // `content` owes no transport.
        new QueuedAuthMailer(this.mailPublisher),
        this.invitationClaimer,
        this.organizationFounder,
        this.invitationLinkClaimer,
      );
      this.sessionResolver = new BetterAuthSessionResolver(this.authInstance);

      const apiKeyRepository = new PgApiKeyRepository(this.cluster, this.transactions, this.shards);
      const apiKeyResolver = new ApiKeyResolver(
        apiKeyRepository,
        this.capabilities,
        this.memberships,
      );

      this.apiKeyUseCases = {
        listApiKeys: new ListApiKeysUseCase(this.authorizer, apiKeyRepository),
        createApiKey: new CreateApiKeyUseCase(
          this.authorizer,
          apiKeyRepository,
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
        ),
        revokeApiKey: new RevokeApiKeyUseCase(
          this.authorizer,
          apiKeyRepository,
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
        ),
      };
      this.principalBuilder = new PrincipalBuilder(
        this.sessionResolver,
        apiKeyResolver,
        this.capabilities,
        this.memberships,
      );

      // Inside the auth block because the mail's link is `auth.baseUrl`. The use-cases
      // hand a token to a port and know nothing about it.
      this.memberUseCases = {
        listMembers: new ListMembersUseCase(this.authorizer, members),
        listInvitations: new ListInvitationsUseCase(this.authorizer, invitations),
        inviteMember: new InviteMemberUseCase(
          this.authorizer,
          roles,
          members,
          invitations,
          new QueuedInvitationMailer(this.mailPublisher, config.email.baseUrl),
          this.activity,
          this.eventPublisher,
          this.catalogUnitOfWork,
          this.clock,
          capabilityRepository,
        ),
        revokeInvitation: new RevokeInvitationUseCase(
          this.authorizer,
          invitations,
          this.activity,
          this.catalogUnitOfWork,
        ),
        resendInvitation: new ResendInvitationUseCase(
          this.authorizer,
          invitations,
          new QueuedInvitationMailer(this.mailPublisher, config.email.baseUrl),
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
        ),
        changeMemberRole: new ChangeMemberRoleUseCase(
          this.authorizer,
          members,
          roles,
          this.capabilities,
          this.activity,
          this.eventPublisher,
          this.catalogUnitOfWork,
          capabilityRepository,
        ),
        setMemberActive: new SetMemberActiveUseCase(
          this.authorizer,
          members,
          this.capabilities,
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
          roles,
          capabilityRepository,
        ),
        removeMember: new RemoveMemberUseCase(
          this.authorizer,
          members,
          this.capabilities,
          this.activity,
          this.catalogUnitOfWork,
          roles,
          capabilityRepository,
        ),
        listInvitationLinks: new ListInvitationLinksUseCase(this.authorizer, invitationLinks),
        createInvitationLink: new CreateInvitationLinkUseCase(
          this.authorizer,
          invitationLinks,
          roles,
          capabilityRepository,
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
        ),
        revokeInvitationLink: new RevokeInvitationLinkUseCase(
          this.authorizer,
          invitationLinks,
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
        ),
        listMemberDomains: new ListMemberDomainsUseCase(this.authorizer, memberDomains),
        addMemberDomain: new AddMemberDomainUseCase(
          this.authorizer,
          memberDomains,
          roles,
          capabilityRepository,
          this.activity,
          this.catalogUnitOfWork,
        ),
        removeMemberDomain: new RemoveMemberDomainUseCase(
          this.authorizer,
          memberDomains,
          this.activity,
          this.catalogUnitOfWork,
        ),
      };

      // Catalog throughout: `users`, memberships and overrides all live there, so no
      // account change needs placing on a tenant's node.
      const accounts = new PgAccountRepository(this.cluster, this.transactions, this.shards);
      const accountOverrides = new PgPermissionOverrideRepository(
        this.cluster,
        this.transactions,
        this.shards,
      );
      this.accountUseCases = {
        findAccount: new FindAccountUseCase(this.authorizer, accounts),
        suspendAccount: new SuspendAccountUseCase(
          this.authorizer,
          accounts,
          this.platform,
          this.capabilities,
          new BetterAuthSessionGateway(this.authInstance),
          this.activity,
          this.catalogUnitOfWork,
          this.clock,
        ),
        reinstateAccount: new ReinstateAccountUseCase(
          this.authorizer,
          accounts,
          this.platform,
          this.capabilities,
          this.activity,
          this.catalogUnitOfWork,
        ),
        denyAccountPermission: new DenyAccountPermissionUseCase(
          this.authorizer,
          accounts,
          accountOverrides,
          this.platform,
          this.capabilities,
          this.activity,
          this.catalogUnitOfWork,
        ),
        clearAccountDeny: new ClearAccountDenyUseCase(
          this.authorizer,
          accountOverrides,
          this.platform,
          this.capabilities,
          this.activity,
          this.catalogUnitOfWork,
        ),
      };
    }

    // `this` is fully assigned by here, and `report()` is only ever called on a
    // request — the reader holds the container, it does not read it during the build.
    this.platformPolicy = new PgPlatformPolicyRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    const flagRepository = new PgFlagRepository(this.cluster, this.transactions, this.shards);
    const entitlements = new PgEntitlementRepository(this.cluster, this.transactions, this.shards);
    // The directory's own lookup, shared by every screen that takes an id or a slug.
    const tenantLookup = new PgShardMapReader(this.cluster, this.transactions, this.shards);
    this.flags = new FlagCache(flagRepository, this.cache);
    this.doc = this.buildDoc(entitlements);

    this.platformAdmin = {
      deleteOrganization: new DeleteOrganizationUseCase(
        this.authorizer,
        new PgTenantRepository(this.cluster, this.transactions, this.shards),
        this.queuePublisher,
        this.platform,
        this.activity,
      ),
      purgeOrganization: new PurgeOrganizationUseCase(
        new PgTenantRepository(this.cluster, this.transactions, this.shards),
        this.partitionArchive,
        this.maintenance,
        this.outbox,
        this.capabilities,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
        this.clock,
        this.shardResolver,
        new DocImageSweep(this.storage),
      ),
      exportOrganization: new ExportOrganizationUseCase(
        this.authorizer,
        new PgTenantRepository(this.cluster, this.transactions, this.shards),
        this.queuePublisher,
        this.platform,
        this.activity,
        this.clock,
      ),
      listExports: new ListTenantExportsUseCase(this.authorizer, this.storage),
      inspectStatus: new InspectPlatformStatusUseCase(
        this.authorizer,
        this.platform,
        new ContainerHealthReader(this),
        this.platformPolicy,
      ),
      toggleReplicaReads: new ToggleReplicaReadsUseCase(
        this.authorizer,
        this.platformPolicy,
        new ContainerHealthReader(this),
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      listFlags: new ListFlagsUseCase(this.authorizer, flagRepository),
      listPlans: new ListPlansUseCase(this.authorizer, entitlements),
      savePlan: new SavePlanUseCase(
        this.authorizer,
        entitlements,
        this.capabilities,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      deletePlan: new DeletePlanUseCase(
        this.authorizer,
        entitlements,
        this.capabilities,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      updateDefaultPlan: new UpdateDefaultPlanUseCase(
        this.authorizer,
        entitlements,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      organizationEntitlement: new GetOrganizationEntitlementUseCase(
        this.authorizer,
        entitlements,
        capabilityRepository,
        roles,
        tenantLookup,
      ),
      assignPlan: new AssignPlanUseCase(
        this.authorizer,
        entitlements,
        this.capabilities,
        tenantLookup,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      adjustEntitlement: new AdjustEntitlementUseCase(
        this.authorizer,
        entitlements,
        this.capabilities,
        tenantLookup,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
        this.clock,
      ),
      clearAdjustment: new ClearEntitlementAdjustmentUseCase(
        this.authorizer,
        entitlements,
        this.capabilities,
        tenantLookup,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      expireAdjustments: new ExpireEntitlementAdjustmentsUseCase(
        entitlements,
        this.capabilities,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      moduleSwitches: new ListModuleSwitchesUseCase(this.authorizer, entitlements),
      switchModule: new SwitchModuleUseCase(
        this.authorizer,
        entitlements,
        this.capabilities,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      updateFlag: new UpdateFlagUseCase(
        this.authorizer,
        flagRepository,
        this.flags,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      updateFlagTarget: new UpdateFlagTargetUseCase(
        this.authorizer,
        flagRepository,
        this.flags,
        new PgShardMapReader(this.cluster, this.transactions, this.shards),
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
    };

    const overrideRepository = new PgPermissionOverrideRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    const overrideDeps = [
      members,
      roles,
      capabilityRepository,
      overrideRepository,
      this.capabilities,
      this.activity,
      this.catalogUnitOfWork,
    ] as const;
    this.overrides = {
      list: new ListPermissionOverridesUseCase(this.authorizer, members, overrideRepository),
      grant: new GrantPermissionOverrideUseCase(this.authorizer, ...overrideDeps, this.clock),
      deny: new DenyPermissionOverrideUseCase(this.authorizer, ...overrideDeps),
      clear: new ClearPermissionOverrideUseCase(this.authorizer, ...overrideDeps),
      expire: new ExpirePermissionOverridesUseCase(
        overrideRepository,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
    };

    const organizationRepository = new PgOrganizationRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    this.organization = {
      get: new GetOrganizationUseCase(this.authorizer, organizationRepository),
      update: new UpdateOrganizationUseCase(
        this.authorizer,
        organizationRepository,
        this.activity,
        this.catalogUnitOfWork,
      ),
      transferOwnership: new TransferOwnershipUseCase(
        this.authorizer,
        members,
        roles,
        this.capabilities,
        this.activity,
        this.eventPublisher,
        this.catalogUnitOfWork,
      ),
      // The same `tenant-delete` job the platform's delete queues.
      remove: new RemoveOrganizationUseCase(
        this.authorizer,
        new PgTenantRepository(this.cluster, this.transactions, this.shards),
        this.queuePublisher,
        this.activity,
      ),
    };
    this.teams = {
      list: new ListTeamsUseCase(this.authorizer, teamRepository),
      members: new ListTeamMembersUseCase(this.authorizer, teamRepository),
      create: new CreateTeamUseCase(
        this.authorizer,
        teamRepository,
        this.activity,
        this.catalogUnitOfWork,
      ),
      update: new UpdateTeamUseCase(
        this.authorizer,
        teamRepository,
        this.activity,
        this.catalogUnitOfWork,
      ),
      remove: new RemoveTeamUseCase(
        this.authorizer,
        teamRepository,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
      addMember: new AddTeamMemberUseCase(
        this.authorizer,
        teamRepository,
        members,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
      removeMember: new RemoveTeamMemberUseCase(
        this.authorizer,
        teamRepository,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
    };
    this.activityLog = {
      list: new ListActivityUseCase(
        this.authorizer,
        new PgActivityReader(this.cluster, this.transactions, this.shards),
        new PgUserReader(this.cluster, this.transactions, this.shards),
      ),
    };

    this.repositoryProvider = config.github
      ? new GithubAppProvider(config.github)
      : new NullRepositoryProvider();
    const projectRepository = new PgProjectRepository(this.cluster, this.transactions, this.shards);
    const scanRepository = new PgScanRepository(this.cluster, this.transactions, this.shards);
    const viewRepository = new PgGraphViewRepository(this.cluster, this.transactions, this.shards);
    const installations = new PgGithubInstallationRepository(
      this.cluster,
      this.transactions,
      this.shards,
    );
    this.projects = {
      list: new ListProjectsUseCase(this.authorizer, projectRepository),
      get: new GetProjectUseCase(projectRepository),
      create: new CreateProjectUseCase(
        this.authorizer,
        projectRepository,
        installations,
        this.repositoryProvider,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
      update: new UpdateProjectUseCase(
        this.authorizer,
        projectRepository,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
      remove: new RemoveProjectUseCase(
        this.authorizer,
        projectRepository,
        this.capabilities,
        this.activity,
        this.queuePublisher,
        this.catalogUnitOfWork,
        this.clock,
      ),
      purge: new PurgeProjectUseCase(projectRepository, this.storage, [
        scanRepository,
        viewRepository,
      ]),
      available: new ListAvailableRepositoriesUseCase(
        this.authorizer,
        installations,
        this.repositoryProvider,
      ),
      repository: new ManageProjectRepositoryUseCase(
        this.authorizer,
        projectRepository,
        installations,
        this.repositoryProvider,
        this.activity,
        this.catalogUnitOfWork,
      ),
      access: new ManageProjectAccessUseCase(
        this.authorizer,
        projectRepository,
        members,
        teamRepository,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
      ),
      accessOverview: new GetProjectAccessOverviewUseCase(this.authorizer, projectRepository),
      tracking: projectRepository,
    };
    const scanConfig = config.scan ?? {
      secret: config.auth?.secret ?? "unconfigured",
      serverUrl: config.email.baseUrl,
      runner: { kind: "none" as const },
    };
    const scanTokens = new HmacScanTokens(scanConfig.secret);
    const scanRunner =
      scanConfig.runner.kind === "github"
        ? new GithubActionsScanRunner({
            repository: scanConfig.runner.repository,
            token: scanConfig.runner.token,
          })
        : scanConfig.runner.kind === "local"
          ? new LocalScanRunner(
              { cliPath: scanConfig.runner.cliPath, serverUrl: scanConfig.serverUrl },
              scanTokens,
            )
          : new NullScanRunner();
    const queueScan = new QueueScanUseCase(
      scanRepository,
      scanRunner,
      this.repositoryProvider,
      this.queuePublisher,
    );
    this.scans = {
      list: new ListScansUseCase(this.authorizer, projectRepository, scanRepository),
      run: new RunScanUseCase(this.authorizer, projectRepository, queueScan, this.activity),
      createUpload: new CreateScanUploadUseCase(
        this.authorizer,
        projectRepository,
        scanRepository,
        scanTokens,
        this.storage,
        this.activity,
        scanConfig.serverUrl,
      ),
      graph: new GetGraphUseCase(this.authorizer, projectRepository, scanRepository, this.storage),
      checkout: new CheckoutScanUseCase(
        scanTokens,
        scanRepository,
        projectRepository,
        this.repositoryProvider,
        this.clock,
      ),
      upload: new UploadScanUseCase(scanTokens, scanRepository, this.storage),
      complete: new CompleteScanUseCase(
        scanTokens,
        scanRepository,
        new StorageGraphArchive(this.storage),
        this.eventPublisher,
        this.routedUnitOfWork,
        this.clock,
      ),
      fail: new FailScanUseCase(
        scanTokens,
        scanRepository,
        this.eventPublisher,
        this.routedUnitOfWork,
        this.clock,
      ),
      dispatch: new DispatchScanUseCase(scanRepository, scanRunner, this.clock),
      trigger: new TriggerScanUseCase(projectRepository, queueScan),
      sweep: new SweepScansUseCase(scanRepository, this.eventPublisher, this.clock),
    };
    this.views = new ManageViewsUseCase(this.authorizer, projectRepository, viewRepository);
    this.github = {
      status: new GetGithubStatusUseCase(this.authorizer, installations, this.repositoryProvider),
      bind: new BindGithubInstallationUseCase(
        this.authorizer,
        installations,
        this.repositoryProvider,
        this.activity,
        this.catalogUnitOfWork,
      ),
      webhook: new HandleGithubWebhookUseCase(installations, projectRepository, this.clock),
      installations,
    };

    this.rbac = {
      listRoles: new ListRolesUseCase(this.authorizer, roles),
      // The same repository `CapabilityCache` reads, deliberately un-cached: an
      // inspector showing a stale answer is worse than one that costs a query.
      inspectEffective: new InspectEffectivePermissionsUseCase(
        this.authorizer,
        members,
        capabilityRepository,
        this.platform,
      ),
      entitlement: new GetEntitlementUseCase(this.authorizer, capabilityRepository),
      createRole: new CreateRoleUseCase(
        this.authorizer,
        roles,
        this.activity,
        this.catalogUnitOfWork,
      ),
      updateRole: new UpdateRoleUseCase(
        this.authorizer,
        roles,
        this.activity,
        this.catalogUnitOfWork,
      ),
      deleteRole: new DeleteRoleUseCase(
        this.authorizer,
        roles,
        this.activity,
        this.catalogUnitOfWork,
      ),
      // `CapabilityCache` bound to the `CapabilityInvalidator` port: the domain states
      // that a grant must flush, and this line is the only one that knows what to.
      grantPermission: new GrantPermissionUseCase(
        this.authorizer,
        roles,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
        this.platform,
      ),
      revokePermission: new RevokePermissionUseCase(
        this.authorizer,
        roles,
        this.capabilities,
        this.activity,
        this.catalogUnitOfWork,
        capabilityRepository,
      ),
    };

    this.ai = {
      // Run by the worker's consumer, off the queue the two below feed.
      indexDocument: new IndexDocumentUseCase(
        this.authorizer,
        this.searchMode,
        this.vectors,
        this.activity,
        this.routedUnitOfWork,
      ),
      queueIndex: new QueueDocumentIndexUseCase(
        this.authorizer,
        this.queuePublisher,
        this.vectors,
        this.clock,
      ),
      searchDocuments: new SearchDocumentsUseCase(
        this.authorizer,
        this.searchMode,
        this.vectors,
        this.activity,
        this.routedUnitOfWork,
      ),
      // The worker's, off `pnpm ai:reindex`: every chunk another model wrote, re-embedded.
      reembed: new ReembedChunksUseCase(
        this.authorizer,
        this.searchMode,
        this.vectors,
        this.routedUnitOfWork,
      ),
    };
  }

  // Three modes, each wrapped so an invited address joins the organization that invited
  // it before the mode is consulted. See docs/reference/container.md.
  private static enroller(
    mode: "personal" | "bootstrap" | "invite",
    bootstrapOrganizationSlug: string | undefined,
    cluster: DatabaseCluster,
    transactions: TransactionScope,
    shards: ShardScope,
    // The port, not `PgOrganizationFounder`: the personal enroller declares the same
    // shape structurally, which is what lets this stay the one place a class is named.
    founder: OrganizationFounder,
    claimer: InvitationClaimer,
    domains: MemberDomainClaimer,
  ): MembershipEnroller {
    const inner = ((): MembershipEnroller => {
      switch (mode) {
        case "personal":
          return new PgPersonalOrganizationEnroller(cluster, transactions, shards, founder);
        case "bootstrap":
          return new PgBootstrapMembershipEnroller(
            cluster,
            transactions,
            shards,
            bootstrapOrganizationSlug,
          );
        case "invite":
          return new NullMembershipEnroller();
      }
    })();

    // An invitation first, then a claimed email domain, then the mode's own answer.
    return new InvitationClaimingEnroller(claimer, new DomainJoiningEnroller(domains, inner));
  }

  // Getters rather than optional fields, so a process that skipped auth fails loudly at
  // the call site rather than silently.
  public get auth(): AuthInstance {
    if (!this.authInstance) throw new Error("This container was built without an auth config.");
    return this.authInstance;
  }

  public get apiKey(): ApiKeyUseCases {
    if (!this.apiKeyUseCases) {
      throw new Error("This container was built without an auth config.");
    }
    return this.apiKeyUseCases;
  }

  public get accounts(): AccountUseCases {
    if (!this.accountUseCases) {
      throw new Error("This container was built without an auth config.");
    }
    return this.accountUseCases;
  }

  public get member(): MemberUseCases {
    if (!this.memberUseCases) {
      throw new Error("This container was built without an auth config.");
    }
    return this.memberUseCases;
  }

  public get sessions(): SessionResolver {
    if (!this.sessionResolver) {
      throw new Error("This container was built without an auth config.");
    }
    return this.sessionResolver;
  }

  public get principals(): PrincipalBuilder {
    if (!this.principalBuilder) {
      throw new Error("This container was built without an auth config.");
    }
    return this.principalBuilder;
  }

  // **The one place a request or a job is placed.** Both run once, here, so
  // `BaseRepository.db` stays a property read — see the sharding reference.
  // ──
  // `recheck` is the worker's: a job can outlive the move's settle — decision `24.2b`.
  public async placed<T>(
    principal: Principal,
    work: () => Promise<T>,
    options: { readonly recheck?: boolean; readonly replica?: boolean } = {},
  ): Promise<T> {
    const key = this.sharding.keyOf(principal);
    // The freeze rides with the node, resolved once here rather than per write: a move
    // makes the tenant readable and unwritable, and `PgUnitOfWork` reads it off scope.
    const placement = await this.shardResolver.placementOf(key);

    return this.shards.within(
      {
        key,
        node: placement.node,
        frozen: placement.frozen,
        recheck: options.recheck,
        replica: options.replica,
      },
      work,
    );
  }

  // Placed by organization alone, for a read that holds no principal of that organization:
  // the platform's public docs. The principal is empty — it places, and asserts nothing.
  public async placedAt<T>(
    organizationId: OrganizationId,
    work: () => Promise<T>,
    options: { readonly replica?: boolean } = {},
  ): Promise<T> {
    const placer = Principal.system(
      organizationId,
      Container.PLACEMENT_USER_ID as UserId,
      CapabilitySet.empty(),
    );
    return this.placed(placer, work, options);
  }

  // Every node's standby, empty when none is configured — what the status panel reads.
  public async replicaHealth(): Promise<readonly ReplicaHealth[]> {
    return this.cluster.replicaHealth();
  }

  public get hasReplicas(): boolean {
    return this.cluster.hasReplicas;
  }

  // **The one place a cross-tenant sweep is placed**, and it is per node rather than
  // per tenant: the outbox, the partition runway and the digest fan-out are per node.
  public async eachShard(work: (node: number) => Promise<void>): Promise<void> {
    let first: Error | null = null;

    // Serial, not `Promise.all`. These are the DDL and drain passes, and running them
    // against every node at once multiplies this process's pool by the shard count.
    for (let node = 0; node < this.cluster.size; node += 1) {
      try {
        await this.shards.atNode(node, () => work(node));
      } catch (error) {
        // One node down delays its own work, never the nodes after it. The first error is
        // rethrown at the end, so the job still fails and BullMQ still retries it.
        first ??= error instanceof Error ? error : new Error(String(error));
        this.logger.emit("shard.sweep.failed", { node });
        this.logger.failure(error, { node });
      }
    }

    if (first !== null) throw first;
  }

  // Postgres and both Redis instances, as a breakdown rather than one boolean: the body
  // of a failing probe is what an operator reads. See docs/reference/container.md.
  public async health(): Promise<HealthReport> {
    const [database, cache, queue, realtime] = await Promise.all([
      this.cluster.isHealthy(),
      this.redis.healthy("cache"),
      this.redis.healthy("queue"),
      // Asked only of a connection that exists. `healthy()` would create one, and a
      // worker reporting on a subscriber it opened to answer this is reporting on itself.
      this.redis.opened("subscriber") ? this.redis.healthy("subscriber") : Promise.resolve(null),
    ]);

    return {
      healthy: Object.values(database).every(Boolean) && cache && queue && realtime !== false,
      database,
      cache,
      queue,
      // `null` rather than `true`: lite runs no analytics store, which is neither healthy
      // nor degraded. Loki is absent from this report on purpose.
      analytics: null,
      realtime,
      // Not part of `healthy`: a saturated pool is a load signal, not a broken
      // dependency, and a health check that fails under load takes the process out.
      pool: this.database.stats(),
    };
  }

  // One line per episode, not per tick: the counter keeps climbing while the queue stays
  // non-empty, and `forMs` is what says whether this is a spike or a ceiling.
  private probePool(): void {
    const pool = this.database.stats();

    if (pool.waiting === 0) {
      this.poolWaitingTicks = 0;
      return;
    }

    this.poolWaitingTicks += 1;
    if (this.poolWaitingTicks < Container.POOL_PROBE_TICKS) return;

    this.logger.emit("database.pool.saturated", {
      waiting: pool.waiting,
      total: pool.total,
      max: pool.max,
      forMs: this.poolWaitingTicks * this.poolProbeMs,
    });
  }

  // A node's standby pool, sized like its primary: what moves onto it is the reads that
  // would otherwise have held a primary connection for the same time.
  private replicaPool(config: ContainerConfig, url: string | undefined): ShardConfig["replica"] {
    if (!url) return undefined;
    return {
      url,
      maxConnections: config.database.poolMax,
      statementTimeoutMs: config.database.statementTimeoutMs,
      idleTimeoutMs: config.database.poolIdleTimeoutMs,
      connectionTimeoutMs: config.database.poolConnectTimeoutMs,
      applicationName: `${config.logging.app}-replica`,
      onError: (error: Error) =>
        this.logger.emit("database.pool.error", { message: error.message }),
    };
  }

  // `Database`'s own default when the config omits one, because the two numbers have to
  // agree: a probe slower than the connect timeout watches a queue that is never there.
  private static probeIntervalFor(connectTimeoutMs: number | undefined): number {
    const timeout = connectTimeoutMs ?? 5_000;
    return Math.max(
      Container.POOL_PROBE_MIN_MS,
      Math.floor(timeout / Container.POOL_PROBE_DIVISOR),
    );
  }

  // Reverse construction order: closing Redis while BullMQ holds blocking connections
  // hangs on shutdown, and it is a deadlock.
  public async dispose(): Promise<void> {
    clearInterval(this.poolProbe);
    // Each step on its own: one close that rejects must not leave the pools after it open.
    await this.closing("queue", () => this.queuePublisher.close());
    await this.closing("redis", () => this.redis.close());
    // Before Postgres only because nothing else depends on it: an unclosed transport is
    // its own reason to be here, not a step in the ordering above.
    await this.closing("smtp", () => this.emailSender.close());
    // The cluster owns every pool including node 0's, so this is the one close and it
    // is last: a repository on any node may still be finishing the lines above.
    await this.closing("postgres", () => this.cluster.close());
  }

  private async closing(what: string, close: () => Promise<unknown>): Promise<void> {
    try {
      await close();
    } catch (error) {
      this.logger.failure(error, { closing: what });
    }
  }

  // Its own method because the slice is eighteen use-cases over four shared collaborators,
  // and inline they would bury the constructor's order of construction.
  private buildDoc(entitlements: PgEntitlementRepository): Container["doc"] {
    const spaces = new PgDocSpaceRepository(this.cluster, this.transactions, this.shards);
    const pages = new PgDocPageRepository(this.cluster, this.transactions, this.shards);
    const renderer: MarkdownRenderer = new UnifiedMarkdownRenderer();
    const tree = new DocTree(pages, spaces);
    const cache = new DocCache(this.cache, spaces, pages);
    const grants = new PgDocGrantRepository(this.cluster, this.transactions, this.shards);
    const access = new DocAccess(grants, this.cache);
    const features = new DocFeaturePolicy(this.flags, entitlements, this.cache);
    const search = new DocSearch(pages, cache, features);
    const images = new DocImageSweep(this.storage);
    const auth = this.authorizer;
    const uow = this.routedUnitOfWork;

    return {
      cache,
      listSpaces: new ListDocSpacesUseCase(auth, cache, features),
      getSpace: new GetDocSpaceUseCase(auth, spaces),
      createSpace: new CreateDocSpaceUseCase(
        auth,
        spaces,
        this.platform,
        cache,
        features,
        this.activity,
        uow,
      ),
      updateSpace: new UpdateDocSpaceUseCase(
        auth,
        spaces,
        this.platform,
        cache,
        features,
        this.activity,
        uow,
      ),
      deleteSpace: new DeleteDocSpaceUseCase(
        auth,
        spaces,
        pages,
        grants,
        access,
        cache,
        this.activity,
        uow,
        images,
      ),
      read: new ReadDocPageUseCase(auth, cache, features),
      readNav: new ReadDocNavUseCase(auth, cache, features),
      accessOptions: new ListDocAccessOptionsUseCase(auth, features),
      tree: new ListDocPagesUseCase(auth, spaces, pages),
      getPage: new GetDocPageUseCase(auth, pages, spaces),
      createPage: new CreateDocPageUseCase(auth, spaces, pages, tree, cache, this.activity, uow),
      savePage: new SaveDocPageUseCase(auth, spaces, pages, tree, cache, features, uow),
      publishPage: new PublishDocPageUseCase(
        auth,
        spaces,
        pages,
        renderer,
        tree,
        cache,
        this.activity,
        uow,
      ),
      movePage: new MoveDocPageUseCase(auth, spaces, pages, tree, cache, this.activity, uow),
      deletePage: new DeleteDocPageUseCase(auth, spaces, pages, tree, cache, this.activity, uow),
      previewPage: new PreviewDocPageUseCase(auth, renderer),
      revisions: new ListDocRevisionsUseCase(auth, pages, spaces),
      revision: new GetDocRevisionUseCase(auth, pages, spaces),
      restoreRevision: new RestoreDocRevisionUseCase(auth, pages, spaces, this.activity, uow),
      readPlatform: new ReadPlatformDocUseCase(this.platform, cache, features, access),
      readPlatformNav: new ReadPlatformDocNavUseCase(this.platform, cache, features, access),
      listPlatformSpaces: new ListPlatformDocSpacesUseCase(this.platform, cache, access, features),
      listGrants: new ListDocGrantsUseCase(auth, grants),
      // The catalog unit of work: a grant is a catalog row, and its audit row is written
      // in whichever transaction is open.
      saveGrant: new SaveDocGrantUseCase(
        auth,
        grants,
        spaces,
        access,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
        this.clock,
      ),
      search: new SearchDocsUseCase(auth, cache, search, features),
      uploadImage: new UploadDocImageUseCase(auth, spaces, this.storage),
      openImage: new OpenDocImageUseCase(this.platform, spaces, access, this.storage),
      searchPlatform: new SearchPlatformDocsUseCase(this.platform, cache, access, search, features),
      revokeGrant: new RevokeDocGrantUseCase(
        auth,
        grants,
        access,
        this.platform,
        this.activity,
        this.catalogUnitOfWork,
      ),
      rerender: new DocRerender(pages, renderer, cache, uow),
    };
  }

  // The one place a vendor is chosen, as a `case` the compiler checks. The default models
  // are each vendor's current small embedding model; both are cut to `dimensions`.
  private static buildSearchMode(config: ContainerConfig["embedding"], logger: Logger): SearchMode {
    switch (config.provider) {
      case "none":
        return { kind: "lexical" };
      case "openai":
        return {
          kind: "semantic",
          provider: new OpenAiEmbeddingProvider(
            {
              apiKey: config.apiKey ?? "",
              model: config.model ?? "text-embedding-3-small",
              dimensions: config.dimensions,
            },
            logger,
          ),
        };
      case "gemini":
        return {
          kind: "semantic",
          provider: new GeminiEmbeddingProvider(
            {
              apiKey: config.apiKey ?? "",
              model: config.model ?? "gemini-embedding-001",
              dimensions: config.dimensions,
            },
            logger,
          ),
        };
    }
  }

  // A static, so adopting a dedicated vector store is a `case` the compiler checks. The
  // swap is cheap because `search()` takes the resolved goal scope as a parameter.
  private static buildVectorStore(
    config: ContainerConfig,
    cluster: DatabaseCluster,
    transactions: TransactionScope,
    shards: ShardScope,
  ): VectorStore {
    switch (config.vector.driver) {
      case "pgvector":
        return new PgVectorStore(cluster, transactions, shards);
      default: {
        // Exhaustiveness at build time: a driver added to the union and not here is a
        // compile error rather than a runtime surprise.
        const unreachable: never = config.vector.driver;
        throw new Error(`Unknown vector driver: ${String(unreachable)}`);
      }
    }
  }
}
