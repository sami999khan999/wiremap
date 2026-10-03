import {
  and,
  asc,
  type CommentId,
  type CommentRecord,
  type CommentRepository,
  type CommentTarget,
  eq,
  isNull,
  type OrganizationId,
  type Placement,
  type ProjectId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { comments } from "../schema/index.js";

type CommentRow = typeof comments.$inferSelect;

export class PgCommentRepository extends BaseRepository implements CommentRepository {
  protected override readonly placement: Placement = "routed";

  public async list(
    organizationId: OrganizationId,
    projectId: ProjectId,
    target: CommentTarget | null,
  ): Promise<readonly CommentRecord[]> {
    const rows = await this.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.organizationId, organizationId),
          eq(comments.projectId, projectId),
          isNull(comments.deletedAt),
          target ? eq(comments.targetKind, target.kind) : undefined,
          target ? eq(comments.targetKey, target.key) : undefined,
        ),
      )
      .orderBy(asc(comments.createdAt));
    return rows.map((row) => PgCommentRepository.record(row));
  }

  public async findById(
    organizationId: OrganizationId,
    id: CommentId,
  ): Promise<CommentRecord | null> {
    const [row] = await this.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.organizationId, organizationId),
          eq(comments.id, id),
          isNull(comments.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgCommentRepository.record(row) : null;
  }

  public async save(
    organizationId: OrganizationId,
    comment: Omit<CommentRecord, "resolvedAt" | "pinned" | "editedAt" | "createdAt">,
  ): Promise<void> {
    await this.db.insert(comments).values({
      id: comment.id,
      organizationId,
      projectId: comment.projectId,
      targetKind: comment.target.kind,
      targetKey: comment.target.key,
      body: comment.body,
      authorId: comment.authorId,
      parentId: comment.parentId,
    });
  }

  public async edit(
    organizationId: OrganizationId,
    id: CommentId,
    body: string,
    at: Date,
  ): Promise<void> {
    await this.db.update(comments).set({ body, editedAt: at }).where(this.one(organizationId, id));
  }

  public async setResolved(
    organizationId: OrganizationId,
    id: CommentId,
    at: Date | null,
  ): Promise<void> {
    await this.db.update(comments).set({ resolvedAt: at }).where(this.one(organizationId, id));
  }

  public async setPinned(
    organizationId: OrganizationId,
    id: CommentId,
    pinned: boolean,
  ): Promise<void> {
    await this.db.update(comments).set({ pinned }).where(this.one(organizationId, id));
  }

  public async remove(organizationId: OrganizationId, id: CommentId, at: Date): Promise<void> {
    await this.db
      .update(comments)
      .set({ deletedAt: at, pinned: false })
      .where(this.one(organizationId, id));
  }

  public async removeForProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    await this.db
      .delete(comments)
      .where(and(eq(comments.organizationId, organizationId), eq(comments.projectId, projectId)));
  }

  private one(organizationId: OrganizationId, id: CommentId) {
    return and(eq(comments.organizationId, organizationId), eq(comments.id, id));
  }

  private static record(row: CommentRow): CommentRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      target: { kind: row.targetKind, key: row.targetKey },
      body: row.body,
      authorId: row.authorId,
      parentId: row.parentId,
      resolvedAt: row.resolvedAt,
      pinned: row.pinned,
      editedAt: row.editedAt,
      createdAt: row.createdAt,
    };
  }
}
