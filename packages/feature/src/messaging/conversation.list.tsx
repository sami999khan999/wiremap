import { useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  type ConversationDto,
  ConversationEntity,
  DataTable,
  DateFormat,
  EmptyState,
  MessagingQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppInfiniteQuery,
  useMemo,
} from "../import.js";

export interface ConversationListProps {
  readonly onOpen: (conversationId: string) => void;
  readonly limit?: number;
}

interface ConversationRow extends ConversationDto {
  readonly id: ConversationDto["id"];
  // Resolved once per page rather than per render: `ConversationEntity.from` parses,
  // and a cell renderer runs on every keystroke somewhere else on the screen.
  readonly displayTitle: string | null;
}

// The keyset envelope, structurally. Restated rather than imported because the contract's
// page type is inferred per procedure and does not survive three packages of re-export.
interface ConversationPage {
  readonly items: readonly ConversationDto[];
  readonly nextCursor: string | null;
}

// Capped in the repository at a hundred, and the badge is what turns that into an honest
// "99+" rather than a number that is quietly wrong.
const BADGE_CAP = 99;

export function ConversationList({ onOpen, limit = 25 }: ConversationListProps) {
  const { t } = useMessages("messaging");
  const describe = useErrorMessage();
  const client = useApiClient();
  const { user } = useSession();
  const self = user?.id ?? "";

  const inbox = useAppInfiniteQuery(MessagingQueries.conversations(client, { limit }));

  const rows = useMemo<readonly ConversationRow[]>(() => {
    const pages: readonly ConversationPage[] = inbox.data?.pages ?? [];
    return pages.flatMap((page) =>
      page.items.map((item) => ({
        ...item,
        id: item.id,
        displayTitle: ConversationEntity.from(item).displayTitle(self),
      })),
    );
  }, [inbox.data, self]);

  const columns = useMemo<readonly TableColumn<ConversationRow>[]>(
    () => [
      {
        key: "title",
        header: t("messaging.inbox.title"),
        cell: (row: ConversationRow) => (
          <Button variant="ghost" onClick={() => onOpen(row.id)}>
            {
              // The generic label only when nobody can be named. "Direct message" on
              // every row is an inbox in which no conversation is findable.
              row.displayTitle ?? t("messaging.inbox.direct")
            }
          </Button>
        ),
      },
      {
        key: "unreadCount",
        header: "",
        cell: (row: ConversationRow) =>
          row.unreadCount > 0 ? (
            <StatusBadge tone="accent">
              {row.unreadCount > BADGE_CAP ? `${BADGE_CAP}+` : String(row.unreadCount)}
            </StatusBadge>
          ) : null,
      },
      {
        key: "lastMessageAt",
        header: "",
        cell: (row: ConversationRow) =>
          row.lastMessageAt ? DateFormat.day(row.lastMessageAt) : null,
      },
    ],
    [t, onOpen],
  );

  if (inbox.isPending) return <DataTable.Skeleton columns={3} rows={5} />;
  if (inbox.isError) {
    return (
      <Callout tone="danger">
        {describe(inbox.error)?.message ?? t("messaging.inbox.error")}
      </Callout>
    );
  }

  if (rows.length === 0) return <EmptyState title={t("messaging.inbox.empty")} />;

  return (
    <div>
      <DataTable columns={columns} rows={rows} />
      {
        // Absent rather than disabled at the end: a permanently greyed button reads as
        // something broken rather than as a list that has finished.
        inbox.hasNextPage ? (
          <Button variant="secondary" onClick={() => void inbox.fetchNextPage()}>
            {t("messaging.inbox.loadMore")}
          </Button>
        ) : null
      }
    </div>
  );
}
