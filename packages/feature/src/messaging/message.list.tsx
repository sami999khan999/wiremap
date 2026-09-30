import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  DateFormat,
  EmptyState,
  type MessageDto,
  MessagingQueries,
  useApiClient,
  useAppInfiniteQuery,
  useMemo,
} from "../import.js";

export interface MessageListProps {
  readonly conversationId: string;
  // From the conversation this thread belongs to, which is where the names are. Absent
  // renders no author at all rather than a uuid, which is what it did before `23.26b`.
  readonly nameFor?: (userId: string) => string | null;
}

// The page envelope, structurally: the contract's type is inferred per procedure and
// does not survive three packages of re-export.
interface MessagePage {
  readonly items: readonly MessageDto[];
  readonly olderCursor: string | null;
}

export function MessageList({ conversationId, nameFor }: MessageListProps) {
  const { t } = useMessages("messaging");
  const describe = useErrorMessage();
  const client = useApiClient();

  const thread = useAppInfiniteQuery(MessagingQueries.messages(client, conversationId));

  // Reversed: the server pages backwards from the newest, and a conversation reads
  // oldest-first down the screen.
  const rows = useMemo<readonly MessageDto[]>(() => {
    const pages: readonly MessagePage[] = thread.data?.pages ?? [];
    return [...pages.flatMap((page) => page.items)].reverse();
  }, [thread.data]);

  if (thread.isPending) return <DataTable.Skeleton columns={1} rows={6} />;
  if (thread.isError) {
    return (
      <Callout tone="danger">
        {describe(thread.error)?.message ?? t("messaging.conversation.error")}
      </Callout>
    );
  }

  if (rows.length === 0) return <EmptyState title={t("messaging.conversation.empty")} />;

  return (
    <div>
      {
        // At the top, because that is the direction older messages are in. Absent rather
        // than disabled once there are none.
        thread.hasNextPage ? (
          <Button variant="secondary" onClick={() => void thread.fetchNextPage()}>
            {t("messaging.conversation.loadOlder")}
          </Button>
        ) : null
      }

      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            {nameFor ? (
              <strong>{nameFor(row.authorId) ?? t("messaging.member.unknown")}</strong>
            ) : null}
            {row.deleted ? <em>{t("messaging.conversation.deleted")}</em> : <span>{row.body}</span>}
            <small>
              {DateFormat.day(row.createdAt)}
              {row.editedAt ? ` · ${t("messaging.conversation.edited")}` : ""}
            </small>
          </li>
        ))}
      </ol>
    </div>
  );
}
