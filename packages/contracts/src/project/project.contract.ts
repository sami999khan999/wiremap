import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

// The three project roles, `goal`-scoped system roles seeded per organization. Ordered
// from most to least, which is how two grants to one person are reconciled.
export const PROJECT_ROLES = ["project_admin", "project_editor", "project_viewer"] as const;

const role = z.enum(PROJECT_ROLES);
// `org`: every member gets the default role. `restricted`: only the grants below.
const visibility = z.enum(["org", "restricted"]);
const schedule = z.enum(["off", "daily", "weekly"]);
// A glob per line, as a `.gitignore` reads; bounded so a pasted file is refused.
const ignore = z.array(z.string().trim().min(1).max(200)).max(100);
const slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export class ProjectContract {
  private constructor() {}

  public static readonly role = role;

  // One repository a project reads: from the GitHub App, or `upload` for a graph the CLI
  // sends from a machine the App cannot reach.
  public static readonly repository = z.object({
    id: Identifiers.repositoryId,
    provider: z.enum(["github", "upload"]),
    externalId: z.string().nullable(),
    fullName: z.string().min(1),
    defaultBranch: z.string().min(1),
    branches: z.array(z.string().min(1)).readonly(),
    // A subfolder for a monorepo whose app lives below the root; null is the root.
    rootPath: z.string().nullable(),
    private: z.boolean(),
  });

  public static readonly entity = z.object({
    id: Identifiers.projectId,
    slug,
    name: z.string().min(1),
    description: z.string().nullable(),
    visibility,
    defaultRole: role,
    schedule,
    ignore: z.array(z.string()).readonly(),
    settings: z.object({
      tsconfigPath: z.string().nullable(),
      workspace: z.string().nullable(),
    }),
    repositories: z.array(ProjectContract.repository).readonly(),
    createdAt: z.date(),
  });

  // What the "connect repositories" picker offers, read from the organization's installations.
  public static readonly available = z.object({
    externalId: z.string().min(1),
    fullName: z.string().min(1),
    defaultBranch: z.string().min(1),
    private: z.boolean(),
  });

  public static readonly ref = z.object({ projectId: Identifiers.projectId });
  public static readonly bySlug = z.object({ slug });

  public static readonly create = z.object({
    name: z.string().trim().min(1).max(80),
    slug,
    description: z.string().trim().max(280).nullable(),
    visibility,
    defaultRole: role,
    repositories: z
      .array(
        z.object({
          externalId: z.string().min(1),
          fullName: z.string().min(1),
          defaultBranch: z.string().min(1),
          private: z.boolean(),
        }),
      )
      .max(20),
  });

  public static readonly update = z.object({
    projectId: Identifiers.projectId,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(280).nullable(),
    visibility,
    defaultRole: role,
    schedule,
    ignore,
    settings: z.object({
      tsconfigPath: z.string().trim().max(200).nullable(),
      workspace: z.string().trim().max(200).nullable(),
    }),
  });

  public static readonly addRepository = z.object({
    projectId: Identifiers.projectId,
    externalId: z.string().min(1),
    fullName: z.string().min(1),
    defaultBranch: z.string().min(1),
    private: z.boolean(),
  });

  public static readonly updateRepository = z.object({
    projectId: Identifiers.projectId,
    repositoryId: Identifiers.repositoryId,
    branches: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    rootPath: z.string().trim().max(200).nullable(),
  });

  public static readonly removeRepository = z.object({
    projectId: Identifiers.projectId,
    repositoryId: Identifiers.repositoryId,
  });

  // Who can see a project and why: a direct grant, a team's, or the org default.
  public static readonly grant = z.object({
    id: Identifiers.projectGrantId,
    kind: z.enum(["user", "team"]),
    userId: Identifiers.userId.nullable(),
    teamId: Identifiers.teamId.nullable(),
    name: z.string(),
    role,
  });

  public static readonly saveGrant = z.object({
    projectId: Identifiers.projectId,
    userId: Identifiers.userId.nullable(),
    teamId: Identifiers.teamId.nullable(),
    role,
  });

  public static readonly revokeGrant = z.object({
    projectId: Identifiers.projectId,
    grantId: Identifiers.projectGrantId,
  });

  public static readonly listQuery = Pagination.query;
}

export type ProjectRole = z.infer<typeof ProjectContract.role>;
export type ProjectDto = z.infer<typeof ProjectContract.entity>;
export type RepositoryDto = z.infer<typeof ProjectContract.repository>;
export type AvailableRepositoryDto = z.infer<typeof ProjectContract.available>;
export type ProjectGrantDto = z.infer<typeof ProjectContract.grant>;
export type CreateProjectInput = z.infer<typeof ProjectContract.create>;
export type UpdateProjectInput = z.infer<typeof ProjectContract.update>;
export type ProjectRefInput = z.infer<typeof ProjectContract.ref>;
export type ProjectBySlugInput = z.infer<typeof ProjectContract.bySlug>;
export type AddRepositoryInput = z.infer<typeof ProjectContract.addRepository>;
export type UpdateRepositoryInput = z.infer<typeof ProjectContract.updateRepository>;
export type RemoveRepositoryInput = z.infer<typeof ProjectContract.removeRepository>;
export type SaveProjectGrantInput = z.infer<typeof ProjectContract.saveGrant>;
export type RevokeProjectGrantInput = z.infer<typeof ProjectContract.revokeGrant>;
