import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  DateFormat,
  EmptyState,
  type NotificationDto,
  NotificationMutations,
  NotificationQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppInfiniteQuery,
  useMemo,
  useState,
} from "../import.js";

export interface NotificationListProps {
  readonly limit?: number;
}

// A row needs a stable `id` for `DataTable`; the notification's own id is that.
interface NotificationRow extends NotificationDto {
  readonly id: NotificationDto["id"];
}

// The keyset envelope, structurally. Restated rather than imported because the contract's
// page type is inferred per procedure and does not survive three packages of re-export.
interface NotificationPage {
  readonly items: readonly NotificationDto[];
  readonly nextCursor: string | null;
}

export function NotificationList({ limit = 25 }: NotificationListProps) {
  const { t } = useMessages("notification");
  // Renders the code the server sent rather than one generic sentence: a 403 and a
  // 409 are different things to be told.
  const describe = useErrorMessage();
  const client = useApiClient();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const params = { limit, unreadOnly };
  const inbox = useAppInfiniteQuery(NotificationQueries.list(client, params));
  const markRead = NotificationMutations.useMarkRead(client, params);
  const markAllRead = NotificationMutations.useMarkAllRead(client);

  const rows = useMemo<readonly NotificationRow[]>(() => {
    // Annotated rather than inferred: the client's procedure types are reconstructed
    // through three packages, and a break anywhere degrades to `any` silently.
    const pages: readonly NotificationPage[] = inbox.data?.pages ?? [];
    return pages.flatMap((page) => page.items.map((item) => ({ ...item, id: item.id })));
  }, [inbox.data]);

  const columns = useMemo<readonly TableColumn<NotificationRow>[]>(
    () => [
      {
        key: "kind",
        header: t("notification.inbox.title"),
        cell: (row: NotificationRow) => (
          <span>
            <strong>{t(`notification.kind.${row.kind}.title` as never)}</strong>
            <br />
            {t(`notification.kind.${row.kind}.body` as never)}
          </span>
        ),
      },
      {
        key: "createdAt",
        header: "",
        cell: (row: NotificationRow) => DateFormat.day(row.createdAt),
      },
      {
        key: "readAt",
        header: "",
        cell: (row: NotificationRow) =>
          row.readAt ? null : (
            <Button
              variant="ghost"
              onClick={() => markRead.mutate({ id: row.id, createdAt: row.createdAt })}
            >
              <StatusBadge tone="accent">{t("notification.inbox.markRead")}</StatusBadge>
            </Button>
          ),
      },
    ],
    [t, markRead],
  );

  // The controls sit above every state, never inside one. Two ways this trapped a
  // reader: the empty state replaced the whole tree, and so did the pending skeleton —
  // ──
  // and toggling the filter re-enters pending, so the button removed itself on click.
  const body = () => {
    if (inbox.isPending) return <DataTable.Skeleton columns={3} rows={5} />;
    if (inbox.isError) {
      return (
        <Callout tone="danger">
          {describe(inbox.error)?.message ?? t("notification.inbox.error")}
        </Callout>
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          title={t(unreadOnly ? "notification.inbox.emptyUnread" : "notification.inbox.empty")}
        />
      );
    }

    return <DataTable columns={columns} rows={rows} />;
  };

  return (
    <div>
      <Button variant="ghost" onClick={() => setUnreadOnly(!unreadOnly)}>
        {t("notification.inbox.unreadOnly")}
      </Button>
      <Button variant="ghost" onClick={() => markAllRead.mutate()}>
        {t("notification.inbox.markAllRead")}
      </Button>

      {body()}

      {
        // Absent rather than disabled at the end: a permanently greyed button reads as
        // something broken rather than as a list that has finished.
        inbox.hasNextPage ? (
          <Button variant="secondary" onClick={() => void inbox.fetchNextPage()}>
            {t("notification.inbox.loadMore")}
          </Button>
        ) : null
      }
    </div>
  );
}
