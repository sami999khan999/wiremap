import { Fragment } from "../import.js";
import { CommentText } from "./comment-text.js";

// Text, never HTML: a mention is the only thing in a body that renders as anything else.
export function CommentBody({
  body,
  people,
}: {
  readonly body: string;
  readonly people: ReadonlyMap<string, string>;
}) {
  return (
    <p className="m-0 whitespace-pre-wrap break-words text-sm">
      {CommentText.parts(body).map((part, index) =>
        part.kind === "text" ? (
          <Fragment key={index}>{part.text}</Fragment>
        ) : (
          <span key={index} className="rounded-sm bg-muted px-0.5 font-medium text-primary">
            @{people.get(part.userId) ?? "…"}
          </span>
        ),
      )}
    </p>
  );
}
