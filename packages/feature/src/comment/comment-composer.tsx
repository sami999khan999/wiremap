import { PLAIN_BUTTON } from "../graph/role-tone.js";
import { useMessages } from "../i18n/index.js";
import { Button, Textarea, useRef, useState } from "../import.js";
import { CommentText } from "./comment-text.js";

export interface CommentComposerProps {
  // userId → name, for the `@` picker. Delivery still checks each one can read the project.
  readonly people: ReadonlyMap<string, string>;
  readonly initial?: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onSubmit: (body: string) => void;
  readonly onCancel?: () => void;
}

export function CommentComposer({
  people,
  initial = "",
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const { t } = useMessages("graph");
  const [draft, setDraft] = useState(() => CommentText.decode(initial, people));
  const [caret, setCaret] = useState(0);
  // name → userId for every mention in the draft, so an edit keeps the ones it began with.
  const chosen = useRef(
    new Map<string, string>(
      CommentText.parts(initial).flatMap((part) => {
        const name = part.kind === "mention" ? people.get(part.userId) : undefined;
        return part.kind === "mention" && name ? [[name, part.userId] as const] : [];
      }),
    ),
  );
  const area = useRef<HTMLTextAreaElement>(null);
  const query = CommentText.query(draft, caret);
  const matches =
    query === null
      ? []
      : [...people]
          .filter(([, name]) => name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 6);

  const pick = (userId: string, name: string) => {
    const before = draft.slice(0, caret).replace(/@[^\s@[\]]*$/, `@${name} `);
    const next = before + draft.slice(caret);
    chosen.current.set(name, userId);
    setDraft(next);
    setCaret(before.length);
    area.current?.focus();
  };

  const submit = () => {
    if (busy || draft.trim() === "") return;
    onSubmit(CommentText.encode(draft.trim(), chosen.current));
    setDraft("");
    chosen.current.clear();
  };

  return (
    <form
      className="relative flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        ref={area}
        aria-label={t("comment.placeholder")}
        placeholder={t("comment.placeholder")}
        rows={2}
        maxLength={10_000}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setCaret(event.target.selectionStart);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {matches.length > 0 ? (
        <ul
          aria-label={t("comment.mention")}
          className="m-0 flex list-none flex-col rounded-md border border-border bg-surface p-1"
        >
          {matches.map(([userId, name]) => (
            <li key={userId}>
              <button
                type="button"
                onClick={() => pick(userId, name)}
                className={`${PLAIN_BUTTON} w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-muted`}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("comment.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="secondary" disabled={busy || draft.trim() === ""}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
