import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  NotificationList,
  NotificationQueries,
  Page,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["notification"] as const satisfies readonly ClientNamespace[];

// Passed to the component as well as to the loader: the query key is built from these,
// so a default that lived only in `NotificationList` would silently prefetch a key
// ──
// nothing reads. `unreadOnly` is the filter's initial state, not a choice made here.
const PAGE = { limit: 25, unreadOnly: false } as const;

// The same key `notification.list` is gated on: removing it has to hide the nav entry
// *and* refuse the call, which is what makes the two halves one decision.
export const Route = createFileRoute("/(app)/_authenticated/notifications")({
  beforeLoad: RouteGuard.requirePermission("notification.inbox.read"),
  staticData: { messages: MESSAGES },
  // Page one beside the copy. The bell's count is the layout's, because the bell is on
  // every page under `_authenticated` rather than on this one.
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureInfiniteQueryData(NotificationQueries.list(context.api, PAGE)),
    ]),
  component: Notifications,
});

function Notifications() {
  const { t } = useMessages("notification");

  return (
    <Page>
      <h1>{t("notification.inbox.title")}</h1>
      <NotificationList limit={PAGE.limit} />
    </Page>
  );
}
