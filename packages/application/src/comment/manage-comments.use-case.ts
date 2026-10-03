import {
  type Clock,
  type CommentId,
  type CommentTarget,
  NotFoundError,
  type ProjectId,
  Uuid,
  ValidationError,
} from "../import.js";
import type {
  ActivityLogger,
  DomainEventPublisher,
  UnitOfWork,
  UserReader,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { CommentRecord, CommentRepository } from "./comment.repository.js";
import { CommentRules } from "./comment.rules.js";

export interface CommentView extends CommentRecord {
  readonly authorName: string;
}

// Comments on a project's files, folders and routes, one level of threads. Editing is the
// author's alone; removing is the author's or a project admin's.
export class ManageCommentsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly comments: CommentRepository,
    private readonly users: UserReader,
    private readonly events: DomainEventPublisher,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async list(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly target: CommentTarget | null },
  ): Promise<readonly CommentView[]> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.graph.read",
    );
    return this.withNames(
      actor,
      await this.comments.list(actor.organizationId, project.id, input.target),
    );
  }

  public async create(
    actor: Principal,
    input: {
      readonly projectId: ProjectId;
      readonly target: CommentTarget;
      readonly body: string;
      readonly parentId: CommentId | null;
    },
  ): Promise<CommentView> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.comment.write",
    );
    const parent = input.parentId
      ? await this.comments.findById(actor.organizationId, input.parentId)
      : null;
    if (input.parentId && (!parent || parent.projectId !== project.id))
      throw new NotFoundError("comment", input.parentId);
    // One level: a reply to a reply joins the thread its parent is in.
    const root = parent?.parentId
      ? await this.comments.findById(actor.organizationId, parent.parentId)
      : parent;
    const id = Uuid.v7() as CommentId;
    const target = root?.target ?? input.target;
    await this.unitOfWork.run(async () => {
      await this.comments.save(actor.organizationId, {
        id,
        projectId: project.id,
        target,
        body: input.body,
        authorId: actor.userId,
        parentId: root?.id ?? null,
      });
      await this.events.publish(actor, {
        name: "comment.created",
        payload: {
          projectId: project.id,
          commentId: id,
          authorId: actor.userId,
          targetKind: target.kind,
          targetKey: target.key,
          replyTo: root && root.authorId !== actor.userId ? root.authorId : null,
          mentions: CommentRules.mentions(input.body).filter((user) => user !== actor.userId),
          excerpt: CommentRules.excerpt(input.body),
        },
      });
      // The feed's row; the body stays in `comments`, so a deletion takes it out of both.
      await this.activity.record(actor, "comment.created", {
        projectId: project.id,
        commentId: id,
        targetKind: target.kind,
        targetKey: target.key,
      });
    });
    return this.one(actor, id);
  }

  public async update(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly commentId: CommentId; readonly body: string },
  ): Promise<CommentView> {
    const comment = await this.load(
      actor,
      input.projectId,
      input.commentId,
      "project.comment.write",
    );
    if (comment.authorId !== actor.userId)
      throw new ValidationError([{ field: "commentId", rule: "notAuthor" }]);
    await this.comments.edit(actor.organizationId, comment.id, input.body, this.clock.now());
    return this.one(actor, comment.id);
  }

  public async remove(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly commentId: CommentId },
  ): Promise<void> {
    const comment = await this.load(
      actor,
      input.projectId,
      input.commentId,
      "project.comment.write",
    );
    if (comment.authorId !== actor.userId)
      this.authorizer.assert(actor, "project.settings.manage", comment.projectId);
    await this.unitOfWork.run(async () => {
      await this.comments.remove(actor.organizationId, comment.id, this.clock.now());
      await this.activity.record(actor, "comment.removed", {
        projectId: comment.projectId,
        commentId: comment.id,
      });
    });
  }

  public async resolve(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly commentId: CommentId; readonly on: boolean },
  ): Promise<CommentView> {
    const comment = await this.load(
      actor,
      input.projectId,
      input.commentId,
      "project.comment.write",
    );
    await this.comments.setResolved(
      actor.organizationId,
      comment.id,
      input.on ? this.clock.now() : null,
    );
    return this.one(actor, comment.id);
  }

  // A pinned comment is a note: it shows on the node and in the overview's notes.
  public async pin(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly commentId: CommentId; readonly on: boolean },
  ): Promise<CommentView> {
    const comment = await this.load(
      actor,
      input.projectId,
      input.commentId,
      "project.comment.write",
    );
    await this.comments.setPinned(actor.organizationId, comment.id, input.on);
    return this.one(actor, comment.id);
  }

  private async load(
    actor: Principal,
    projectId: ProjectId,
    commentId: CommentId,
    permission: "project.comment.write",
  ): Promise<CommentRecord> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      projectId,
      permission,
    );
    const comment = await this.comments.findById(actor.organizationId, commentId);
    if (!comment || comment.projectId !== project.id) throw new NotFoundError("comment", commentId);
    return comment;
  }

  private async one(actor: Principal, id: CommentId): Promise<CommentView> {
    const comment = await this.comments.findById(actor.organizationId, id);
    if (!comment) throw new NotFoundError("comment", id);
    return (await this.withNames(actor, [comment]))[0] as CommentView;
  }

  private async withNames(
    actor: Principal,
    comments: readonly CommentRecord[],
  ): Promise<CommentView[]> {
    const names = await this.users.namesOf(actor.organizationId, [
      ...new Set(comments.map((comment) => comment.authorId)),
    ]);
    return comments.map((comment) => ({
      ...comment,
      authorName: names.get(comment.authorId) ?? "",
    }));
  }
}
