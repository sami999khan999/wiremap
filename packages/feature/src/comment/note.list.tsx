import { PLAIN_BUTTON } from "../graph/role-tone.js";
import { useMessages } from "../i18n/index.js";
import type { CommentDto } from "../import.js";
import { CommentBody } from "./comment-body.js";

// Pinned comments: the project's notes, each a link to the node it is about.
export function NoteList({
  comments,
  people,
  onSelect,
}: {
  readonly comments: readonly CommentDto[];
  readonly people: ReadonlyMap<string, string>;
  readonly onSelect: (path: string) => void;
}) {
  const { t } = useMessages("graph");
  const notes = comments.filter((comment) => comment.pinned);
  if (notes.length === 0) return null;
  return (
    <section>
      <h3 className="m-0 mb-1 text-xs font-semibold uppercase text-fg-muted">
        {t("comment.notes")}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {notes.map((note) => (
          <li key={note.id} className="rounded-md border border-border p-2">
            {note.target.kind === "file" || note.target.kind === "folder" ? (
              <button
                type="button"
                onClick={() => onSelect(note.target.key)}
                className={`${PLAIN_BUTTON} mb-1 block max-w-full truncate font-mono text-[11px] text-fg-muted hover:text-fg`}
              >
                {note.target.key}
              </button>
            ) : (
              <span className="mb-1 block font-mono text-[11px] text-fg-muted">
                {note.target.key || t("comment.project")}
              </span>
            )}
            <CommentBody body={note.body} people={people} />
            <span className="text-[11px] text-fg-muted">{note.authorName}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
