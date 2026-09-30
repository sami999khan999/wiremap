import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  MessagingMutations,
  Textarea,
  useApiClient,
  useRef,
  useState,
} from "../import.js";

export interface MessageComposerProps {
  readonly conversationId: string;
}

// Matches the use-case's own rate limit. Throttling here as well keeps the request off
// the wire rather than having the server refuse it forty times a sentence.
const TYPING_INTERVAL_MS = 2_000;

export function MessageComposer({ conversationId }: MessageComposerProps) {
  const { t } = useMessages("messaging");
  const describe = useErrorMessage();
  const client = useApiClient();

  const [body, setBody] = useState("");
  const lastTypedAt = useRef(0);

  const send = MessagingMutations.useSend(client, conversationId);
  const typing = MessagingMutations.useStartTyping(client);

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;

    // The client generates the key, which is both the optimistic id and the dedupe key:
    // a retried send carries the same one and produces one row.
    send.mutate({ conversationId, body: trimmed, clientId: crypto.randomUUID() });
    setBody("");
  };

  const signal = () => {
    const now = Date.now();
    if (now - lastTypedAt.current < TYPING_INTERVAL_MS) return;

    lastTypedAt.current = now;
    typing.mutate({ conversationId });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        rows={3}
        value={body}
        placeholder={t("messaging.compose.placeholder")}
        onChange={(event) => {
          setBody(event.target.value);
          signal();
        }}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter breaks the line. The convention every chat client
          // shares, and the reason this is a textarea rather than an input.
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          submit();
        }}
      />
      <small>{t("messaging.compose.hint")}</small>

      <Button type="submit" variant="primary" disabled={body.trim().length === 0}>
        {t("messaging.compose.send")}
      </Button>

      {send.isError ? (
        <Callout tone="danger">
          {describe(send.error)?.message ?? t("messaging.compose.failed")}
        </Callout>
      ) : null}
    </form>
  );
}
