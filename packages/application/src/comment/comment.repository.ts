import type { CommentId, CommentTarget, OrganizationId, ProjectId, UserId } from "../import.js";

export interface CommentRecord {
  readonly id: CommentId;
  readonly projectId: ProjectId;
  readonly target: CommentTarget;
  readonly body: string;
  readonly authorId: UserId;
  readonly parentId: CommentId | null;
  readonly resolvedAt: Date | null;
  readonly pinned: boolean;
  readonly editedAt: Date | null;
  readonly createdAt: Date;
}

// A project's comments. Tenant rows, routed with its scans; a deleted comment is gone from
// every read, and a deleted project sweeps them all.
export abstract class CommentRepository {
  public abstract list(
    organizationId: OrganizationId,
    projectId: ProjectId,
    target: CommentTarget | null,
  ): Promise<readonly CommentRecord[]>;

  public abstract findById(
    organizationId: OrganizationId,
    id: CommentId,
  ): Promise<CommentRecord | null>;

  public abstract save(
    organizationId: OrganizationId,
    comment: Omit<CommentRecord, "resolvedAt" | "pinned" | "editedAt" | "createdAt">,
  ): Promise<void>;

  public abstract edit(
    organizationId: OrganizationId,
    id: CommentId,
    body: string,
    at: Date,
  ): Promise<void>;

  public abstract setResolved(
    organizationId: OrganizationId,
    id: CommentId,
    at: Date | null,
  ): Promise<void>;

  public abstract setPinned(
    organizationId: OrganizationId,
    id: CommentId,
    pinned: boolean,
  ): Promise<void>;

  // Soft: a reply keeps its place under a removed comment.
  public abstract remove(organizationId: OrganizationId, id: CommentId, at: Date): Promise<void>;

  public abstract removeForProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void>;
}
