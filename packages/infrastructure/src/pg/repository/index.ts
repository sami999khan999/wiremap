// Every concrete Postgres adapter, one file each, flat: they are all the same kind of
// thing, and the subject that earns a folder is the external system one level up.

export { PgAccountRepository } from "./pg-account.repository.js";
export { PgActivityLogger } from "./pg-activity.logger.js";
export { PgActivityReader } from "./pg-activity.reader.js";
export { PgAiSettingsRepository } from "./pg-ai-settings.repository.js";
export { PgApiKeyRepository } from "./pg-api-key.repository.js";
export { PgBootstrapMembershipEnroller } from "./pg-bootstrap-membership.enroller.js";
export { PgCapabilityRepository } from "./pg-capability.repository.js";
export { PgDocGrantRepository } from "./pg-doc-grant.repository.js";
export { PgDocPageRepository } from "./pg-doc-page.repository.js";
export { PgDocSpaceRepository } from "./pg-doc-space.repository.js";
export { PgEntitlementRepository } from "./pg-entitlement.repository.js";
export { PgFlagRepository } from "./pg-flag.repository.js";
export { PgGithubInstallationRepository } from "./pg-github-installation.repository.js";
export { PgGraphViewRepository } from "./pg-graph-view.repository.js";
export { PgInvitationClaimer } from "./pg-invitation.claimer.js";
export { PgInvitationRepository } from "./pg-invitation.repository.js";
export {
  type InvitationLinkPreview,
  PgInvitationLinkClaimer,
} from "./pg-invitation-link.claimer.js";
export { PgInvitationLinkRepository } from "./pg-invitation-link.repository.js";
export { PgMaintenanceGateway } from "./pg-maintenance.gateway.js";
export { PgMemberRepository } from "./pg-member.repository.js";
export { PgMemberDomainClaimer } from "./pg-member-domain.claimer.js";
export { PgMemberDomainRepository } from "./pg-member-domain.repository.js";
export { PgMembershipReader } from "./pg-membership.reader.js";
export { PgNotificationRepository } from "./pg-notification.repository.js";
export { PgNotificationPreferenceRepository } from "./pg-notification-preference.repository.js";
export { PgNotificationRecipientReader } from "./pg-notification-recipient.reader.js";
export { PgOrganizationFounder } from "./pg-organization.founder.js";
export { PgOrganizationReader } from "./pg-organization.reader.js";
export { PgOrganizationRepository } from "./pg-organization.repository.js";
export { PgOutboxGateway } from "./pg-outbox.gateway.js";
export { PgOutboxPublisher } from "./pg-outbox.publisher.js";
export { PgPartitionArchiveGateway } from "./pg-partition-archive.gateway.js";
export { PgPermissionOverrideRepository } from "./pg-permission-override.repository.js";
export { PgPersonalOrganizationEnroller } from "./pg-personal-organization.enroller.js";
export { PgPlatformReader } from "./pg-platform.reader.js";
export { PgPlatformPolicyRepository } from "./pg-platform-policy.repository.js";
export { PgProjectRepository } from "./pg-project.repository.js";
export { PgRoleRepository } from "./pg-role.repository.js";
export { PgScanRepository } from "./pg-scan.repository.js";
export { PgShardResolver } from "./pg-shard.resolver.js";
export { PgShardMapReader } from "./pg-shard-map.reader.js";
export { PgTeamRepository } from "./pg-team.repository.js";
export { PgTenantRepository } from "./pg-tenant.repository.js";
export { PgUserReader } from "./pg-user.reader.js";
export { PgVectorStore } from "./pg-vector.store.js";
