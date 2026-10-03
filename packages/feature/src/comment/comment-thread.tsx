import { PLAIN_BUTTON } from "../graph/role-tone.js";
import { useMessages } from "../i18n/index.js";
import {
  Avatar,
  type CommentDto,
  CommentMutations,
  type CommentTarget,
  type ProjectId,
  useApiClient,
  useState,
} from "../import.js";
import { CommentBody } from "./comment-body.js";
import { CommentComposer } from "./comment-composer.js";

const ACTION = `${PLAIN_BUTTON} rounded-sm px-1 text-xs text-fg-muted hover:bg-muted hover:text-fg`;

export interface CommentThreadProps {
  readonly projectId: ProjectId;
  readonly target: CommentTarget;
  // The project's whole list; the thread takes its target's share.
  readonly comments: readonly CommentDto[];
  readonly people: ReadonlyMap<string, string>;
  readonly currentUserId: string | null;
  readonly canWrite: boolean;
  // A project admin removes anyone's comment; everyone else only their own.
  readonly canModerate: boolean;
}

function CommentItem({
  comment,
  props,
  onReply,
}: {
  readonly comment: CommentDto;
  readonly props: CommentThreadProps;
  readonly onReply?: () => void;
}) {
  const { t } = useMessages("graph");
  const client = useApiClient();
  const [editing, setEditing] = useState(false);
  const update = CommentMutations.useUpdate(client);
  const remove = CommentMutations.useRemove(client);
  const resolve = CommentMutations.useResolve(client);
  const pin = CommentMutations.usePin(client);
  const ref = { projectId: props.projectId, commentId: comment.id };
  const own = comment.authorId === props.currentUserId;

  return (
    <article
      className={`flex gap-2 ${comment.resolvedAt ? "opacity-60" : ""}`}
      aria-label={comment.authorName}
    >
      <Avatar name={comment.authorName} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold">{comment.authorName}</span>
          <time className="text-fg-muted" dateTime={comment.createdAt.toISOString()}>
            {comment.createdAt.toLocaleString()}
          </time>
          {comment.editedAt ? <span className="text-fg-muted">{t("comment.edited")}</span> : null}
          {comment.pinned ? <span className="text-primary">{t("comment.pinned")}</span> : null}
          {comment.resolvedAt ? (
            <span className="text-fg-muted">{t("comment.resolved")}</span>
          ) : null}
        </div>
        {editing ? (
          <CommentComposer
            people={props.people}
            initial={comment.body}
            submitLabel={t("comment.save")}
            busy={update.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={(body) =>
              update.mutate({ ...ref, body }, { onSuccess: () => setEditing(false) })
            }
          />
        ) : (
          <CommentBody body={comment.body} people={props.people} />
        )}
        {props.canWrite && !editing ? (
          <div className="flex flex-wrap gap-2">
            {onReply ? (
              <button type="button" className={ACTION} onClick={onReply}>
                {t("comment.reply")}
              </button>
            ) : null}
            {comment.parentId === null ? (
              <>
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => resolve.mutate({ ...ref, on: !comment.resolvedAt })}
                >
                  {comment.resolvedAt ? t("comment.reopen") : t("comment.resolve")}
                </button>
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => pin.mutate({ ...ref, on: !comment.pinned })}
                >
                  {comment.pinned ? t("comment.unpin") : t("comment.pin")}
                </button>
              </>
            ) : null}
            {own ? (
              <button type="button" className={ACTION} onClick={() => setEditing(true)}>
                {t("comment.edit")}
              </button>
            ) : null}
            {own || props.canModerate ? (
              <button type="button" className={ACTION} onClick={() => remove.mutate(ref)}>
                {t("comment.remove")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

// One target's comments, a level of replies under each, and the composer at the foot.
export function CommentThread(props: CommentThreadProps) {
  const { t } = useMessages("graph");
  const client = useApiClient();
  const create = CommentMutations.useCreate(client);
  const [replying, setReplying] = useState<string | null>(null);
  const mine = props.comments.filter(
    (comment) =>
      comment.target.kind === props.target.kind && comment.target.key === props.target.key,
  );
  const roots = mine.filter((comment) => comment.parentId === null);
  const post = (body: string, parentId: CommentDto["id"] | null) =>
    create.mutate(
      { projectId: props.projectId, target: props.target, body, parentId },
      { onSuccess: () => setReplying(null) },
    );

  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-xs font-semibold uppercase text-fg-muted">
        {t("comment.title", { count: mine.length })}
      </h3>
      {roots.length === 0 ? <p className="m-0 text-xs text-fg-muted">{t("comment.none")}</p> : null}
      {roots.map((root) => (
        <div key={root.id} className="flex flex-col gap-2">
          <CommentItem
            comment={root}
            props={props}
            onReply={() => setReplying(replying === root.id ? null : root.id)}
          />
          <div className="ml-8 flex flex-col gap-2 border-l border-border pl-3">
            {mine
              .filter((reply) => reply.parentId === root.id)
              .map((reply) => (
                <CommentItem key={reply.id} comment={reply} props={props} />
              ))}
            {replying === root.id ? (
              <CommentComposer
                people={props.people}
                submitLabel={t("comment.reply")}
                busy={create.isPending}
                onCancel={() => setReplying(null)}
                onSubmit={(body) => post(body, root.id)}
              />
            ) : null}
          </div>
        </div>
      ))}
      {create.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {t("comment.failed")}
        </p>
      ) : null}
      {props.canWrite ? (
        <CommentComposer
          people={props.people}
          submitLabel={t("comment.post")}
          busy={create.isPending}
          onSubmit={(body) => post(body, null)}
        />
      ) : null}
    </section>
  );
}
