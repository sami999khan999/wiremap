import { useMessages } from "../i18n/index.js";
import {
  Icon,
  NotificationQueries,
  Popover,
  StatusBadge,
  useApiClient,
  useAppQuery,
} from "../import.js";
import { NotificationPeek } from "./notification-peek.list.js";

export interface NotificationBellProps {
  // An `href` rather than a router: `feature` may not import routing, so the shell
  // passes the destination it declared. The peek links to it; the bell no longer is it.
  readonly href: string;
  readonly limit?: number;
}

// Past the repository's cap the count comes back as exactly 100, which the badge renders
// as "99+" — counting further is work nobody reads.
const CAP = 100;

export function NotificationBell({ href, limit = 5 }: NotificationBellProps) {
  const { t } = useMessages("notification");
  const client = useApiClient();
  const unread = useAppQuery(NotificationQueries.unreadCount(client));

  const count = unread.data?.count ?? 0;

  return (
    <Popover
      label={t("notification.inbox.open")}
      trigger={
        <>
          <Icon name="bell" />
          {
            // Absent rather than a zero badge: an empty bell is the quiet state, and a
            // "0" reads as a number worth looking at.
            count > 0 ? (
              <StatusBadge tone="danger">{count >= CAP ? "99+" : String(count)}</StatusBadge>
            ) : null
          }
        </>
      }
    >
      {
        // Mounted only while the popover is open, which is what keeps the list out of
        // every page that renders a bell.
      }
      <NotificationPeek href={href} limit={limit} />
    </Popover>
  );
}
