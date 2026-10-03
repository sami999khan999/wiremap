import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export const COMMENT_TARGETS = ["file", "folder", "route", "project"] as const;

const target = z.object({
  kind: z.enum(COMMENT_TARGETS),
  // A path for a file or folder, a route id (`GET /users`), or `""` for the project.
  key: z.string().max(1_100),
});

// Plain text with mentions written `@[<userId>]`. Rendered as text, never as HTML, so a
// comment cannot carry markup into anyone's page.
const body = z.string().trim().min(1).max(10_000);

export class CommentContract {
  private constructor() {}

  public static readonly target = target;

  public static readonly entity = z.object({
    id: Identifiers.commentId,
    projectId: Identifiers.projectId,
    target,
    body: z.string(),
    authorId: Identifiers.userId,
    authorName: z.string(),
    // One level of threads: a reply names its parent, and a reply has no replies.
    parentId: Identifiers.commentId.nullable(),
    resolvedAt: z.date().nullable(),
    pinned: z.boolean(),
    editedAt: z.date().nullable(),
    createdAt: z.date(),
  });

  public static readonly list = z.object({
    projectId: Identifiers.projectId,
    // Absent: every comment on the project, for the counts and the notes.
    target: target.nullable(),
  });

  public static readonly create = z.object({
    projectId: Identifiers.projectId,
    target,
    body,
    parentId: Identifiers.commentId.nullable(),
  });

  public static readonly update = z.object({
    projectId: Identifiers.projectId,
    commentId: Identifiers.commentId,
    body,
  });

  public static readonly ref = z.object({
    projectId: Identifiers.projectId,
    commentId: Identifiers.commentId,
  });

  public static readonly toggle = z.object({
    projectId: Identifiers.projectId,
    commentId: Identifiers.commentId,
    on: z.boolean(),
  });
}

export type CommentDto = z.infer<typeof CommentContract.entity>;
export type CommentTarget = z.infer<typeof CommentContract.target>;
export type CommentListInput = z.infer<typeof CommentContract.list>;
export type CreateCommentInput = z.infer<typeof CommentContract.create>;
export type UpdateCommentInput = z.infer<typeof CommentContract.update>;
export type CommentRefInput = z.infer<typeof CommentContract.ref>;
export type ToggleCommentInput = z.infer<typeof CommentContract.toggle>;
