import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DateFormat,
  EmptyState,
  type NotificationDto,
  NotificationMutations,
  NotificationQueries,
  useApiClient,
  useAppInfiniteQuery,
} from "../import.js";

export interface NotificationPeekProps {
  // An `href` rather than a router: `feature` may not import routing, so the shell
  // passes the destination it declared.
  readonly href: string;
  readonly limit?: number;
}

// The keyset envelope, structurally. Restated rather than imported because the contract's
// page type is inferred per procedure and does not survive three packages of re-export.
interface NotificationPage {
  readonly items: readonly NotificationDto[];
  readonly nextCursor: string | null;
}

// What the bell opens: the newest unread, and a way to the inbox. **Unread only**, which
// is what makes it a peek rather than a second inbox in a smaller box.
export function NotificationPeek({ href, limit = 5 }: NotificationPeekProps) {
  const { t } = useMessages("notification");
  const describe = useErrorMessage();
  const client = useApiClient();

  // The same read the inbox makes, capped. A different `limit` is a different cache
  // entry, so opening this does not overwrite the page the inbox is holding.
  const params = { limit, unreadOnly: true };
  const inbox = useAppInfiniteQuery(NotificationQueries.list(client, params));
  const markRead = NotificationMutations.useMarkRead(client, params);

  // The first page and no more: `fetchNextPage` is the inbox's job, and a popover that
  // grew as you scrolled would be one.
  const pages: readonly NotificationPage[] = inbox.data?.pages ?? [];
  const items: readonly NotificationDto[] = pages[0]?.items ?? [];

  if (inbox.isError) {
    return (
      <Callout tone="danger">
        {describe(inbox.error)?.message ?? t("notification.inbox.error")}
      </Callout>
    );
  }

  return (
    <div>
      {inbox.isPending ? <p>{t("notification.peek.loading")}</p> : null}
      {inbox.isSuccess && items.length === 0 ? (
        <EmptyState title={t("notification.inbox.emptyUnread")} />
      ) : null}

      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{t(`notification.kind.${item.kind}.title` as never)}</strong>{" "}
              <small>{DateFormat.day(item.createdAt)}</small>
              <br />
              {t(`notification.kind.${item.kind}.body` as never)}{" "}
              <Button
                variant="ghost"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate({ id: item.id, createdAt: item.createdAt })}
              >
                {t("notification.peek.markRead")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {
        // Always, even when the peek is empty: the inbox holds the read ones too, and a
        // link that disappeared when there was nothing new would be the wrong lesson.
      }
      <a href={href}>{t("notification.peek.seeAll")}</a>
    </div>
  );
}
