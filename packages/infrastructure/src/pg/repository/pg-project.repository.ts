import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type NewRepository,
  type OrganizationId,
  type Placement,
  type PolledRepository,
  type ProjectFields,
  type ProjectGrantId,
  type ProjectGrantRecord,
  type ProjectId,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectRole,
  type ReachMember,
  type ReachSource,
  type RepositoryId,
  type RepositoryRecord,
  sql,
  type TeamId,
  type TrackingProject,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import {
  permissionOverrides,
  projectGrants,
  projectRepositories,
  projects,
  teams,
  users,
} from "../schema/index.js";

type ProjectRow = typeof projects.$inferSelect;
type RepositoryRow = typeof projectRepositories.$inferSelect;

export class PgProjectRepository extends BaseRepository implements ProjectRepository {
  // Projects are access metadata: read beside capabilities, in the catalog.
  protected override readonly placement: Placement = "catalog";

  // Two queries, fixed: the projects, then every repository of all of them.
  public async listAll(organizationId: OrganizationId): Promise<readonly ProjectRecord[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), isNull(projects.deletedAt)))
      .orderBy(asc(projects.name));
    return this.withRepositories(organizationId, rows);
  }

  public async findById(
    organizationId: OrganizationId,
    id: ProjectId,
  ): Promise<ProjectRecord | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.id, id),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return (await this.withRepositories(organizationId, rows))[0] ?? null;
  }

  public async findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<ProjectRecord | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.slug, slug),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return (await this.withRepositories(organizationId, rows))[0] ?? null;
  }

  public async save(organizationId: OrganizationId, project: ProjectFields): Promise<void> {
    const values = {
      ...project,
      organizationId,
      ignore: [...project.ignore],
      settings: { ...project.settings },
    };
    await this.db
      .insert(projects)
      .values(values)
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: values.name,
          description: values.description,
          visibility: values.visibility,
          defaultRole: values.defaultRole,
          schedule: values.schedule,
          ignore: values.ignore,
          settings: values.settings,
          updatedAt: sql`now()`,
        },
        setWhere: eq(projects.organizationId, organizationId),
      });
  }

  public async markDeleted(organizationId: OrganizationId, id: ProjectId, at: Date): Promise<void> {
    await this.db
      .update(projects)
      .set({ deletedAt: at })
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, id)));
  }

  // Grants and repositories cascade; a goal-level override names the project by id only.
  public async purge(organizationId: OrganizationId, id: ProjectId): Promise<boolean> {
    const removed = await this.db
      .delete(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.id, id),
          isNotNull(projects.deletedAt),
        ),
      )
      .returning({ id: projects.id });
    if (removed.length === 0) return false;
    await this.db
      .delete(permissionOverrides)
      .where(
        and(
          eq(permissionOverrides.organizationId, organizationId),
          eq(permissionOverrides.goalId, id),
        ),
      );
    return true;
  }

  public async addRepository(
    organizationId: OrganizationId,
    projectId: ProjectId,
    repository: NewRepository,
  ): Promise<void> {
    await this.db.insert(projectRepositories).values({
      ...repository,
      organizationId,
      projectId,
      // The default branch alone until someone chooses more.
      branches: [repository.defaultBranch],
    });
  }

  public async updateRepository(
    organizationId: OrganizationId,
    projectId: ProjectId,
    repositoryId: RepositoryId,
    change: { readonly branches: readonly string[]; readonly rootPath: string | null },
  ): Promise<void> {
    await this.db
      .update(projectRepositories)
      .set({ branches: [...change.branches], rootPath: change.rootPath })
      .where(
        and(
          eq(projectRepositories.organizationId, organizationId),
          eq(projectRepositories.projectId, projectId),
          eq(projectRepositories.id, repositoryId),
        ),
      );
  }

  public async removeRepository(
    organizationId: OrganizationId,
    projectId: ProjectId,
    repositoryId: RepositoryId,
  ): Promise<void> {
    await this.db
      .delete(projectRepositories)
      .where(
        and(
          eq(projectRepositories.organizationId, organizationId),
          eq(projectRepositories.projectId, projectId),
          eq(projectRepositories.id, repositoryId),
        ),
      );
  }

  // Names resolved in the same statement: a grant names a member or a team of this tenant.
  public async grants(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly ProjectGrantRecord[]> {
    const rows = await this.db
      .select({
        id: projectGrants.id,
        userId: projectGrants.userId,
        teamId: projectGrants.teamId,
        role: projectGrants.role,
        userName: users.name,
        teamName: teams.name,
      })
      .from(projectGrants)
      .leftJoin(users, eq(users.id, projectGrants.userId))
      .leftJoin(teams, eq(teams.id, projectGrants.teamId))
      .where(
        and(
          eq(projectGrants.organizationId, organizationId),
          eq(projectGrants.projectId, projectId),
        ),
      )
      .orderBy(asc(projectGrants.createdAt));
    return rows.map((row) => ({
      id: row.id as ProjectGrantId,
      kind: row.userId ? ("user" as const) : ("team" as const),
      userId: row.userId,
      teamId: row.teamId as TeamId | null,
      name: row.userName ?? row.teamName ?? "",
      role: row.role,
    }));
  }

  // Upsert on whichever partial index the grantee falls under, so saving again changes the role.
  public async saveGrant(
    organizationId: OrganizationId,
    projectId: ProjectId,
    grant: {
      readonly userId: UserId | null;
      readonly teamId: TeamId | null;
      readonly role: ProjectRole;
    },
  ): Promise<ProjectGrantId> {
    const [row] = await this.db
      .insert(projectGrants)
      .values({ id: Uuid.v7(), organizationId, projectId, ...grant })
      .onConflictDoUpdate({
        target: grant.userId
          ? [projectGrants.organizationId, projectGrants.projectId, projectGrants.userId]
          : [projectGrants.organizationId, projectGrants.projectId, projectGrants.teamId],
        targetWhere: grant.userId
          ? sql`${projectGrants.userId} is not null`
          : sql`${projectGrants.teamId} is not null`,
        set: { role: grant.role },
      })
      .returning({ id: projectGrants.id });
    return row?.id as ProjectGrantId;
  }

  public async revokeGrant(
    organizationId: OrganizationId,
    projectId: ProjectId,
    grantId: ProjectGrantId,
  ): Promise<void> {
    await this.db
      .delete(projectGrants)
      .where(
        and(
          eq(projectGrants.organizationId, organizationId),
          eq(projectGrants.projectId, projectId),
          eq(projectGrants.id, grantId),
        ),
      );
  }

  // Two statements: the active members with whether their role reads every project, then
  // every source of project access. The use-case folds them; nothing here picks a winner.
  public async reach(organizationId: OrganizationId): Promise<{
    readonly members: readonly ReachMember[];
    readonly sources: readonly ReachSource[];
  }> {
    const members = await this.db.execute<{
      user_id: UserId;
      name: string;
      email: string;
      role_key: string;
      org_wide: boolean;
    }>(sql`
      select m.user_id, u.name, u.email, r.key as role_key,
        exists (
          select 1 from role_permissions rp
          where rp.role_id = m.role_id and rp.permission = 'project.graph.read'
        ) as org_wide
      from memberships m
      join users u on u.id = m.user_id
      join roles r on r.id = m.role_id
      where m.organization_id = ${organizationId} and m.deactivated_at is null
      order by u.name
    `);
    const sources = await this.db.execute<{
      project_id: ProjectId;
      user_id: UserId;
      role: ProjectRole;
      via: "default" | "direct" | "team";
      team_name: string | null;
    }>(sql`
      select p.id as project_id, m.user_id, p.default_role as role, 'default' as via,
        null as team_name
      from projects p
      join memberships m on m.organization_id = p.organization_id and m.deactivated_at is null
      where p.organization_id = ${organizationId} and p.visibility = 'org'
        and p.deleted_at is null
      union all
      select g.project_id, g.user_id, g.role, 'direct', null
      from project_grants g
      join projects p on p.id = g.project_id and p.deleted_at is null
      where g.organization_id = ${organizationId} and g.user_id is not null
      union all
      select g.project_id, t.user_id, g.role, 'team', tm.name
      from project_grants g
      join projects p on p.id = g.project_id and p.deleted_at is null
      join teams tm on tm.id = g.team_id
      join team_members t on t.organization_id = g.organization_id and t.team_id = g.team_id
      where g.organization_id = ${organizationId}
    `);
    return {
      members: members.rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        roleKey: row.role_key,
        orgWide: row.org_wide,
      })),
      sources: sources.rows.map((row) => ({
        projectId: row.project_id,
        userId: row.user_id,
        role: row.role,
        via: row.via,
        teamName: row.team_name,
      })),
    };
  }

  // Across tenants, on `project_repositories_external_idx`: a push names a repository and
  // no organization. Live projects only.
  public async trackingRepository(
    provider: "github",
    externalId: string,
  ): Promise<readonly TrackingProject[]> {
    const rows = await this.db
      .select({
        organizationId: projectRepositories.organizationId,
        projectId: projectRepositories.projectId,
        repositoryId: projectRepositories.id,
        branches: projectRepositories.branches,
      })
      .from(projectRepositories)
      .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
      .where(
        and(
          eq(projectRepositories.provider, provider),
          eq(projectRepositories.externalId, externalId),
          isNull(projects.deletedAt),
        ),
      );
    return rows.map((row) => PgProjectRepository.tracking(row));
  }

  public async polledRepositories(): Promise<readonly PolledRepository[]> {
    const rows = await this.db
      .select({
        organizationId: projectRepositories.organizationId,
        projectId: projectRepositories.projectId,
        repositoryId: projectRepositories.id,
        installationId: projectRepositories.installationId,
        fullName: projectRepositories.fullName,
        branches: projectRepositories.branches,
        defaultBranch: projectRepositories.defaultBranch,
      })
      .from(projectRepositories)
      .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
      .where(
        and(
          eq(projectRepositories.provider, "github"),
          isNotNull(projectRepositories.installationId),
          isNull(projects.deletedAt),
        ),
      );
    return rows.map((row) => ({
      organizationId: row.organizationId,
      projectId: row.projectId as ProjectId,
      repositoryId: row.repositoryId as RepositoryId,
      installationId: row.installationId as number,
      fullName: row.fullName,
      branches: row.branches.length > 0 ? row.branches : [row.defaultBranch],
    }));
  }

  public async renameRepository(
    provider: "github",
    externalId: string,
    fullName: string,
  ): Promise<number> {
    const renamed = await this.db
      .update(projectRepositories)
      .set({ fullName })
      .where(
        and(
          eq(projectRepositories.provider, provider),
          eq(projectRepositories.externalId, externalId),
        ),
      )
      .returning({ id: projectRepositories.id });
    return renamed.length;
  }

  // One statement claims and marks, so two ticks racing never queue one project twice. Five
  // minutes of slack keeps an hourly tick from slipping a daily schedule by a whole hour.
  public async claimScheduled(
    now: Date,
  ): Promise<
    readonly { readonly organizationId: OrganizationId; readonly projectId: ProjectId }[]
  > {
    const rows = await this.db.execute<{ organization_id: OrganizationId; id: ProjectId }>(sql`
      update projects
      set last_scheduled_at = ${now}
      where deleted_at is null
        and (
          (schedule = 'daily'
            and (last_scheduled_at is null
              or last_scheduled_at <= ${now}::timestamptz - interval '1 day' + interval '5 minutes'))
          or (schedule = 'weekly'
            and (last_scheduled_at is null
              or last_scheduled_at <= ${now}::timestamptz - interval '7 days' + interval '5 minutes'))
        )
      returning organization_id, id
    `);
    return rows.rows.map((row) => ({ organizationId: row.organization_id, projectId: row.id }));
  }

  private async withRepositories(
    organizationId: OrganizationId,
    rows: readonly ProjectRow[],
  ): Promise<readonly ProjectRecord[]> {
    if (rows.length === 0) return [];
    const repositories = await this.db
      .select()
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.organizationId, organizationId),
          inArray(
            projectRepositories.projectId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(asc(projectRepositories.fullName));
    const byProject = new Map<string, RepositoryRecord[]>();
    for (const repository of repositories) {
      const list = byProject.get(repository.projectId) ?? [];
      list.push(PgProjectRepository.repository(repository));
      byProject.set(repository.projectId, list);
    }
    return rows.map((row) => ({
      id: row.id as ProjectId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      defaultRole: row.defaultRole,
      schedule: row.schedule,
      ignore: row.ignore,
      settings: row.settings,
      repositories: byProject.get(row.id) ?? [],
      createdAt: row.createdAt,
    }));
  }

  private static repository(row: RepositoryRow): RepositoryRecord {
    return {
      id: row.id as RepositoryId,
      provider: row.provider,
      externalId: row.externalId,
      fullName: row.fullName,
      defaultBranch: row.defaultBranch,
      branches: row.branches,
      rootPath: row.rootPath,
      private: row.private,
      installationId: row.installationId,
    };
  }

  private static tracking(row: {
    organizationId: string;
    projectId: string;
    repositoryId: string;
    branches: string[];
  }): TrackingProject {
    return {
      organizationId: row.organizationId as OrganizationId,
      projectId: row.projectId as ProjectId,
      repositoryId: row.repositoryId as RepositoryId,
      branches: row.branches,
    };
  }
}
