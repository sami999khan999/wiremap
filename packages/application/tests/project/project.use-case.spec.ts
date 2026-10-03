import type {
  OrganizationId,
  ProjectGrantId,
  ProjectId,
  ProjectRole,
  TeamId,
  UserId,
} from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { BindGithubInstallationUseCase } from "../../src/github/bind-github-installation.use-case.js";
import { GithubInstallationRepository } from "../../src/github/github-installation.repository.js";
import { HandleGithubWebhookUseCase } from "../../src/github/handle-github-webhook.use-case.js";
import type { MemberRepository } from "../../src/member/member.repository.js";
import { QueuePublisher } from "../../src/port/queue.publisher.js";
import {
  type ProviderInstallation,
  type ProviderRepository,
  RepositoryProvider,
} from "../../src/port/repository.provider.js";
import type { StorageGateway } from "../../src/port/storage.gateway.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import { CreateProjectUseCase } from "../../src/project/create-project.use-case.js";
import { GetProjectAccessOverviewUseCase } from "../../src/project/get-project-access-overview.use-case.js";
import { ListProjectsUseCase } from "../../src/project/list-projects.use-case.js";
import { ManageProjectAccessUseCase } from "../../src/project/manage-project-access.use-case.js";
import {
  type NewRepository,
  type ProjectFields,
  type ProjectGrantRecord,
  type ProjectRecord,
  ProjectRepository,
  type ReachMember,
  type ReachSource,
  type TrackingProject,
} from "../../src/project/project.repository.js";
import { ProjectRules } from "../../src/project/project.rules.js";
import { PurgeProjectUseCase } from "../../src/project/purge-project.use-case.js";
import { RemoveProjectUseCase } from "../../src/project/remove-project.use-case.js";
import { UpdateProjectUseCase } from "../../src/project/update-project.use-case.js";
import type { TeamRepository } from "../../src/team/team.repository.js";
import {
  ACTOR,
  CLOCK,
  DirectUnitOfWork,
  holding,
  ORG,
  OTHER,
  RecordingActivity,
  RecordingInvalidator,
} from "../support/wiremap-fakes.js";

class MemoryProjects extends ProjectRepository {
  public polledRepositories() {
    return Promise.resolve([]);
  }
  public readonly rows: ProjectRecord[] = [];
  public readonly grantRows: (ProjectGrantRecord & { projectId: ProjectId })[] = [];
  public readonly deleted = new Set<string>();
  public readonly purged: ProjectId[] = [];
  public renamed: { externalId: string; fullName: string } | null = null;
  public reachRows: { members: ReachMember[]; sources: ReachSource[] } = {
    members: [],
    sources: [],
  };

  public listAll() {
    return Promise.resolve(this.rows.filter((row) => !this.deleted.has(row.id)));
  }
  public findById(_org: OrganizationId, id: ProjectId) {
    return Promise.resolve(this.rows.find((row) => row.id === id && !this.deleted.has(id)) ?? null);
  }
  public findBySlug(_org: OrganizationId, slug: string) {
    return Promise.resolve(this.rows.find((row) => row.slug === slug) ?? null);
  }
  public save(_org: OrganizationId, project: ProjectFields) {
    const index = this.rows.findIndex((row) => row.id === project.id);
    const record = { ...project, repositories: [], createdAt: new Date() };
    if (index === -1) this.rows.push(record);
    else this.rows[index] = { ...record, repositories: this.rows[index]?.repositories ?? [] };
    return Promise.resolve();
  }
  public markDeleted(_org: OrganizationId, id: ProjectId) {
    this.deleted.add(id);
    return Promise.resolve();
  }
  public purge(_org: OrganizationId, id: ProjectId) {
    this.purged.push(id);
    return Promise.resolve(this.deleted.has(id));
  }
  public addRepository(_org: OrganizationId, projectId: ProjectId, repository: NewRepository) {
    const row = this.rows.find((each) => each.id === projectId);
    if (row) {
      const next = { ...repository, branches: [repository.defaultBranch], rootPath: null };
      Object.assign(row, { repositories: [...row.repositories, next] });
    }
    return Promise.resolve();
  }
  public updateRepository() {
    return Promise.resolve();
  }
  public removeRepository() {
    return Promise.resolve();
  }
  public grants(_org: OrganizationId, projectId: ProjectId) {
    return Promise.resolve(this.grantRows.filter((grant) => grant.projectId === projectId));
  }
  public saveGrant(
    _org: OrganizationId,
    projectId: ProjectId,
    grant: { userId: UserId | null; teamId: TeamId | null; role: ProjectRole },
  ) {
    const id =
      `018f8c00-0000-7000-8000-${String(this.grantRows.length).padStart(12, "0")}` as ProjectGrantId;
    this.grantRows.push({
      id,
      projectId,
      kind: grant.userId ? "user" : "team",
      userId: grant.userId,
      teamId: grant.teamId,
      name: "",
      role: grant.role,
    });
    return Promise.resolve(id);
  }
  public revokeGrant() {
    return Promise.resolve();
  }
  public tracking: TrackingProject[] = [];
  public trackingRepository() {
    return Promise.resolve(this.tracking);
  }
  public claimScheduled() {
    return Promise.resolve([]);
  }
  public reach() {
    return Promise.resolve(this.reachRows);
  }
  public renameRepository(_provider: "github", externalId: string, fullName: string) {
    this.renamed = { externalId, fullName };
    return Promise.resolve(1);
  }
}

class MemoryInstallations extends GithubInstallationRepository {
  public rows: {
    organizationId: OrganizationId;
    installationId: number;
    accountLogin: string;
    suspended: boolean;
  }[] = [];
  public removed: number[] = [];
  public list(organizationId: OrganizationId) {
    return Promise.resolve(this.rows.filter((row) => row.organizationId === organizationId));
  }
  public bind(
    organizationId: OrganizationId,
    installation: { installationId: number; accountLogin: string },
  ) {
    this.rows.push({ organizationId, ...installation, suspended: false });
    return Promise.resolve();
  }
  public organizationsOf(installationId: number) {
    return Promise.resolve(
      this.rows
        .filter((row) => row.installationId === installationId)
        .map((row) => row.organizationId),
    );
  }
  public setSuspended(installationId: number, at: Date | null) {
    for (const row of this.rows) {
      if (row.installationId === installationId) row.suspended = at !== null;
    }
    return Promise.resolve();
  }
  public remove(installationId: number) {
    this.removed.push(installationId);
    return Promise.resolve();
  }
}

class FakeProvider extends RepositoryProvider {
  public override readonly configured = true;
  public constructor(private readonly available: readonly ProviderRepository[] = []) {
    super();
  }
  public installUrl() {
    return "https://github.com/apps/test/installations/new";
  }
  public organizationFromState(state: string) {
    return state === "good" ? ORG : null;
  }
  public installation(installationId: number): Promise<ProviderInstallation | null> {
    return Promise.resolve({ installationId, accountLogin: "acme" });
  }
  public branchHead() {
    return Promise.resolve(null);
  }
  // The person behind code "mine" can see installation 9 and nothing else.
  public installationsOfUser(code: string) {
    return Promise.resolve(code === "mine" ? [9] : null);
  }
  public repositories() {
    return Promise.resolve(this.available);
  }
  public branches() {
    return Promise.resolve(["main"]);
  }
  public readToken() {
    return Promise.resolve({ token: "t", expiresAt: new Date() });
  }
  public fileAt() {
    return Promise.resolve(null);
  }
  public verifyWebhook() {
    return true;
  }
}

class RecordingQueue extends QueuePublisher {
  public readonly jobs: { queue: string; name: string | undefined }[] = [];
  public publish<T>(queue: string, _payload: T, options?: { name?: string }) {
    this.jobs.push({ queue, name: options?.name });
    return Promise.resolve();
  }
}

const API: ProviderRepository = {
  externalId: "7",
  fullName: "acme/api",
  defaultBranch: "main",
  private: true,
};

// A principal holding `org` keys everywhere and `goal` keys in the projects named.
const withGoals = (
  org: readonly PermissionKey[],
  goals: Record<string, readonly PermissionKey[]>,
) =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: org, denies: [] },
      goals: Object.fromEntries(
        Object.entries(goals).map(([id, grants]) => [id, { grants, denies: [] }]),
      ),
    }),
  );

const createInput = {
  name: "Shop",
  slug: "shop",
  description: null,
  visibility: "org" as const,
  defaultRole: "project_editor" as const,
  repositories: [API],
};

const creator = (projects: MemoryProjects, installations = new MemoryInstallations()) => {
  installations.rows.push({
    organizationId: ORG,
    installationId: 9,
    accountLogin: "acme",
    suspended: false,
  });
  const activity = new RecordingActivity();
  const invalidator = new RecordingInvalidator();
  const useCase = new CreateProjectUseCase(
    new Authorizer(),
    projects,
    installations,
    new FakeProvider([API]),
    invalidator,
    activity,
    new DirectUnitOfWork(),
  );
  return { useCase, activity, invalidator };
};

describe("CreateProjectUseCase", () => {
  it("creates the project with its repositories, and makes the creator its admin", async () => {
    const projects = new MemoryProjects();
    const { useCase, activity, invalidator } = creator(projects);

    const project = await useCase.execute(holding("project.create"), createInput);

    expect(project.repositories.map((repository) => repository.fullName)).toEqual(["acme/api"]);
    expect(project.ignore).toEqual(ProjectRules.DEFAULT_IGNORE);
    expect(projects.grantRows).toMatchObject([{ userId: ACTOR, role: "project_admin" }]);
    expect(activity.actions()).toEqual(["project.created"]);
    expect(invalidator.organizations).toBe(1);
  });

  it("refuses a taken slug, a repository the installations cannot see, and no key", async () => {
    const projects = new MemoryProjects();
    const { useCase } = creator(projects);
    await useCase.execute(holding("project.create"), createInput);

    await expect(useCase.execute(holding("project.create"), createInput)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      useCase.execute(holding("project.create"), {
        ...createInput,
        slug: "other",
        repositories: [{ ...API, externalId: "999" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCase.execute(holding("member.read"), { ...createInput, slug: "third" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("project reads and writes", () => {
  const seeded = async () => {
    const projects = new MemoryProjects();
    const { useCase } = creator(projects);
    const open = await useCase.execute(holding("project.create"), createInput);
    const hidden = await useCase.execute(holding("project.create"), {
      ...createInput,
      slug: "hidden",
      visibility: "restricted",
    });
    return { projects, open, hidden };
  };

  it("lists only the projects the viewer may read", async () => {
    const { projects, open } = await seeded();
    const viewer = withGoals(["member.read"], { [open.id]: ["project.graph.read"] });

    const page = await new ListProjectsUseCase(new Authorizer(), projects).execute(viewer, {
      limit: 50,
      offset: 0,
    });

    expect(page.items.map((project) => project.slug)).toEqual(["shop"]);
    expect(page.total).toBe(1);
  });

  it("answers NOT_FOUND for an unreadable project and FORBIDDEN for a read-only one", async () => {
    const { projects, open, hidden } = await seeded();
    const reader = withGoals(["member.read"], { [open.id]: ["project.graph.read"] });
    const update = new UpdateProjectUseCase(
      new Authorizer(),
      projects,
      new RecordingInvalidator(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );
    const change = {
      name: "Renamed",
      description: null,
      visibility: "org" as const,
      defaultRole: "project_viewer" as const,
      schedule: "daily" as const,
      ignore: ["dist"],
      settings: { tsconfigPath: null, workspace: null },
    };

    await expect(
      update.execute(reader, { projectId: hidden.id, ...change }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(update.execute(reader, { projectId: open.id, ...change })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Settings alone may not change who sees the project: the default role is access.
    const settings = withGoals([], {
      [open.id]: ["project.graph.read", "project.settings.manage"],
    });
    await expect(
      update.execute(settings, { projectId: open.id, ...change }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const unchanged = { ...change, defaultRole: "project_editor" as const };
    expect((await update.execute(settings, { projectId: open.id, ...unchanged })).schedule).toBe(
      "daily",
    );
  });

  it("removes at once and queues the purge, which deletes the objects first", async () => {
    const { projects, open } = await seeded();
    const queue = new RecordingQueue();
    const admin = withGoals([], { [open.id]: ["project.graph.read", "project.delete"] });

    await new RemoveProjectUseCase(
      new Authorizer(),
      projects,
      new RecordingInvalidator(),
      new RecordingActivity(),
      queue,
      new DirectUnitOfWork(),
      CLOCK,
    ).execute(admin, { projectId: open.id });

    expect(await projects.findById(ORG, open.id)).toBeNull();
    expect(queue.jobs).toEqual([{ queue: "maintenance", name: "project-delete" }]);

    const prefix = ProjectRules.storagePrefix(ORG, open.id);
    const keys = new Set([`${prefix}a.json.gz`, `${prefix}b.json.gz`, "graphs/other/x.json.gz"]);
    const storage = {
      list: (wanted: string) =>
        Promise.resolve([...keys].filter((key) => key.startsWith(wanted)).slice(0, 1)),
      delete: (key: string) => {
        keys.delete(key);
        return Promise.resolve();
      },
    } as unknown as StorageGateway;

    const purged = await new PurgeProjectUseCase(projects, storage, [
      { removeForProject: () => Promise.resolve() },
    ]).execute({
      organizationId: ORG,
      projectId: open.id,
    });

    expect(purged.objects).toBe(2);
    expect([...keys]).toEqual(["graphs/other/x.json.gz"]);
    expect(projects.purged).toEqual([open.id]);
  });
});

describe("ManageProjectAccessUseCase", () => {
  it("takes exactly one grantee, who must be of this tenant", async () => {
    const projects = new MemoryProjects();
    const { useCase } = creator(projects);
    const project = await useCase.execute(holding("project.create"), createInput);
    const admin = withGoals([], { [project.id]: ["project.graph.read", "project.access.manage"] });
    const members = {
      findByUser: (_org: OrganizationId, userId: UserId) =>
        Promise.resolve(userId === OTHER ? { userId } : null),
    } as unknown as MemberRepository;
    const teams = { findById: () => Promise.resolve(null) } as unknown as TeamRepository;
    const invalidator = new RecordingInvalidator();
    const access = new ManageProjectAccessUseCase(
      new Authorizer(),
      projects,
      members,
      teams,
      invalidator,
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );
    const save = { kind: "save" as const, projectId: project.id, role: "project_viewer" as const };

    await expect(
      access.execute(admin, { ...save, userId: OTHER, teamId: "t" as TeamId }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      access.execute(admin, { ...save, userId: ACTOR, teamId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const grants = await access.execute(admin, { ...save, userId: OTHER, teamId: null });

    expect(grants.map((grant) => grant.userId)).toContain(OTHER);
    expect(invalidator.organizations).toBe(1);
  });
});

describe("GitHub", () => {
  it("binds an installation only for the organization its state was signed for", async () => {
    const installations = new MemoryInstallations();
    const bind = new BindGithubInstallationUseCase(
      new Authorizer(),
      installations,
      new FakeProvider(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );

    await expect(
      bind.execute(holding("project.create"), { installationId: 9, state: "forged", code: "mine" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await bind.execute(holding("project.create"), {
      installationId: 9,
      state: "good",
      code: "mine",
    });

    expect(installations.rows).toMatchObject([{ installationId: 9, accountLogin: "acme" }]);
  });

  // The installation id is a URL parameter: a valid state of one's own must not be enough
  // to claim an installation somebody else made.
  it("refuses an installation the person installing cannot see, or with no code", async () => {
    const installations = new MemoryInstallations();
    const bind = new BindGithubInstallationUseCase(
      new Authorizer(),
      installations,
      new FakeProvider(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );
    const actor = holding("project.create");

    await expect(
      bind.execute(actor, { installationId: 10, state: "good", code: "mine" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      bind.execute(actor, { installationId: 9, state: "good", code: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      bind.execute(actor, { installationId: 9, state: "good", code: "someone-else" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(installations.rows).toEqual([]);
  });

  it("refuses an installation another organization already holds", async () => {
    const installations = new MemoryInstallations();
    await installations.bind("018f8c00-0000-7000-8000-0000000000ff" as typeof ORG, {
      installationId: 9,
      accountLogin: "acme",
    });
    const bind = new BindGithubInstallationUseCase(
      new Authorizer(),
      installations,
      new FakeProvider(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );

    await expect(
      bind.execute(holding("project.create"), { installationId: 9, state: "good", code: "mine" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("applies installation and repository events and ignores the rest", async () => {
    const installations = new MemoryInstallations();
    const projects = new MemoryProjects();
    const webhook = new HandleGithubWebhookUseCase(installations, projects, CLOCK);
    const base = { installationId: 9, repository: null };

    expect(await webhook.execute({ ...base, event: "installation", action: "deleted" })).toEqual({
      kind: "applied",
    });
    expect(
      await webhook.execute({
        ...base,
        event: "repository",
        action: "renamed",
        repository: { id: 7, fullName: "acme/api-v2" },
      }),
    ).toEqual({ kind: "applied" });
    expect(await webhook.execute({ ...base, event: "push", action: null })).toEqual({
      kind: "ignored",
    });

    expect(installations.removed).toEqual([9]);
    expect(projects.renamed).toEqual({ externalId: "7", fullName: "acme/api-v2" });
  });
});

describe("GetProjectAccessOverviewUseCase", () => {
  it("folds every source into one role per cell: highest wins, viewers capped, org roles read all", async () => {
    const projects = new MemoryProjects();
    const { useCase } = creator(projects);
    const project = await useCase.execute(holding("project.create"), createInput);
    const VIEWER = "018f8c00-0000-7000-8000-0000000000a3" as UserId;
    const member = (userId: UserId, roleKey: string, orgWide = false): ReachMember => ({
      userId,
      name: roleKey,
      email: `${roleKey}@example.test`,
      roleKey,
      orgWide,
    });
    projects.reachRows = {
      members: [member(ACTOR, "admin", true), member(OTHER, "member"), member(VIEWER, "viewer")],
      sources: [
        {
          projectId: project.id,
          userId: OTHER,
          role: "project_editor",
          via: "default",
          teamName: null,
        },
        {
          projectId: project.id,
          userId: OTHER,
          role: "project_admin",
          via: "team",
          teamName: "Core",
        },
        {
          projectId: project.id,
          userId: VIEWER,
          role: "project_admin",
          via: "direct",
          teamName: null,
        },
      ],
    };
    const overview = new GetProjectAccessOverviewUseCase(new Authorizer(), projects);

    const result = await overview.execute(holding("project.access.overview"));
    const cell = (userId: UserId) => result.cells.find((each) => each.userId === userId);

    expect(cell(ACTOR)).toMatchObject({ role: "project_admin", via: "organization" });
    expect(cell(OTHER)).toMatchObject({ role: "project_admin", via: "team", teamName: "Core" });
    expect(cell(VIEWER)).toMatchObject({ role: "project_viewer", via: "direct" });
    expect(result.members[0]).not.toHaveProperty("orgWide");
    await expect(overview.execute(holding("member.read"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("HandleGithubWebhookUseCase on a push", () => {
  it("names the projects tracking the pushed branch, and nothing for another branch", async () => {
    const projects = new MemoryProjects();
    const PROJECT = "018f8c00-0000-7000-8000-0000000000f1" as ProjectId;
    projects.tracking = [
      {
        organizationId: ORG,
        projectId: PROJECT,
        repositoryId: "018f8c00-0000-7000-8000-0000000000f2" as never,
        branches: ["main"],
      },
    ];
    const webhook = new HandleGithubWebhookUseCase(new MemoryInstallations(), projects, CLOCK);
    const push = (ref: string) =>
      webhook.execute({
        event: "push",
        action: null,
        installationId: 9,
        repository: { id: 7, fullName: "acme/api" },
        ref,
      });

    expect(await push("refs/heads/main")).toEqual({
      kind: "push",
      targets: [{ organizationId: ORG, projectId: PROJECT, branch: "main" }],
    });
    expect(await push("refs/heads/feature")).toEqual({ kind: "ignored" });
    expect(await push("refs/tags/v1")).toEqual({ kind: "ignored" });
  });
});
