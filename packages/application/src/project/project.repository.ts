import type {
  OrganizationId,
  ProjectGrantId,
  ProjectId,
  ProjectRole,
  RepositoryId,
  TeamId,
  UserId,
} from "../import.js";

export interface RepositoryRecord {
  readonly id: RepositoryId;
  readonly provider: "github" | "upload";
  readonly externalId: string | null;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly branches: readonly string[];
  readonly rootPath: string | null;
  readonly private: boolean;
  // Which installation reads it. Null for an upload, which nothing reads.
  readonly installationId: number | null;
}

export interface ProjectRecord {
  readonly id: ProjectId;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "org" | "restricted";
  readonly defaultRole: ProjectRole;
  readonly schedule: "off" | "daily" | "weekly";
  readonly ignore: readonly string[];
  readonly settings: { readonly tsconfigPath: string | null; readonly workspace: string | null };
  readonly repositories: readonly RepositoryRecord[];
  readonly createdAt: Date;
}

export interface ProjectGrantRecord {
  readonly id: ProjectGrantId;
  readonly kind: "user" | "team";
  readonly userId: UserId | null;
  readonly teamId: TeamId | null;
  readonly name: string;
  readonly role: ProjectRole;
}

export interface ProjectFields {
  readonly id: ProjectId;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "org" | "restricted";
  readonly defaultRole: ProjectRole;
  readonly schedule: "off" | "daily" | "weekly";
  readonly ignore: readonly string[];
  readonly settings: { readonly tsconfigPath: string | null; readonly workspace: string | null };
}

export interface NewRepository {
  readonly id: RepositoryId;
  readonly provider: "github" | "upload";
  readonly externalId: string | null;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly installationId: number | null;
}

// Every active member, and whether their organization role reads every project already.
export interface ReachMember {
  readonly userId: UserId;
  readonly name: string;
  readonly email: string;
  readonly roleKey: string;
  readonly orgWide: boolean;
}

// One way a project reaches a member: its org default, a direct grant, or a team's.
export interface ReachSource {
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly role: ProjectRole;
  readonly via: "default" | "direct" | "team";
  readonly teamName: string | null;
}

// A project tracking a repository, as a push webhook resolves it: across tenants, because
// the push names a repository and nothing else.
export interface TrackingProject {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly repositoryId: RepositoryId;
  readonly branches: readonly string[];
}

export abstract class ProjectRepository {
  // Every live project of the tenant, repositories included. The use-case filters it to
  // what the viewer may read; there are tens per tenant, not thousands.
  public abstract listAll(organizationId: OrganizationId): Promise<readonly ProjectRecord[]>;

  public abstract findById(
    organizationId: OrganizationId,
    id: ProjectId,
  ): Promise<ProjectRecord | null>;

  public abstract findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<ProjectRecord | null>;

  // Upsert on the id, so create and settings changes are one write.
  public abstract save(organizationId: OrganizationId, project: ProjectFields): Promise<void>;

  // Hidden at once; its data is purged by the `project-delete` maintenance job.
  public abstract markDeleted(
    organizationId: OrganizationId,
    id: ProjectId,
    at: Date,
  ): Promise<void>;

  // The row and everything that cascades from it, only once it was marked deleted: a
  // replayed job for a live project removes nothing. True when a row went.
  public abstract purge(organizationId: OrganizationId, id: ProjectId): Promise<boolean>;

  public abstract addRepository(
    organizationId: OrganizationId,
    projectId: ProjectId,
    repository: NewRepository,
  ): Promise<void>;

  public abstract updateRepository(
    organizationId: OrganizationId,
    projectId: ProjectId,
    repositoryId: RepositoryId,
    change: { readonly branches: readonly string[]; readonly rootPath: string | null },
  ): Promise<void>;

  public abstract removeRepository(
    organizationId: OrganizationId,
    projectId: ProjectId,
    repositoryId: RepositoryId,
  ): Promise<void>;

  public abstract grants(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly ProjectGrantRecord[]>;

  // One grant per person or team per project: saving again changes the role.
  public abstract saveGrant(
    organizationId: OrganizationId,
    projectId: ProjectId,
    grant: {
      readonly userId: UserId | null;
      readonly teamId: TeamId | null;
      readonly role: ProjectRole;
    },
  ): Promise<ProjectGrantId>;

  public abstract revokeGrant(
    organizationId: OrganizationId,
    projectId: ProjectId,
    grantId: ProjectGrantId,
  ): Promise<void>;

  // A repository renamed or transferred on the host keeps its id; every project tracking
  // it follows the new name. Across tenants, like `trackingRepository`.
  public abstract renameRepository(
    provider: "github",
    externalId: string,
    fullName: string,
  ): Promise<number>;

  // Every source of project access in the tenant, unreduced: the overview folds it.
  public abstract reach(organizationId: OrganizationId): Promise<{
    readonly members: readonly ReachMember[];
    readonly sources: readonly ReachSource[];
  }>;

  // Projects whose schedule is due at `now`, across tenants, each marked scheduled in the
  // same statement so two ticks never queue one twice.
  public abstract claimScheduled(
    now: Date,
  ): Promise<readonly { readonly organizationId: OrganizationId; readonly projectId: ProjectId }[]>;

  public abstract trackingRepository(
    provider: "github",
    externalId: string,
  ): Promise<readonly TrackingProject[]>;
}
