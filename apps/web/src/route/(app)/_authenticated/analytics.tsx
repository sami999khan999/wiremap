import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityTrendPanel,
  AnalyticsQueries,
  type ClientNamespace,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["analytics"] as const satisfies readonly ClientNamespace[];

// `ROUTES.analytics.activity`, behind the key the procedure is gated on. The thirty-day
// read is prefetched because it is what the panel opens on.
export const Route = createFileRoute("/(app)/_authenticated/analytics")({
  beforeLoad: RouteGuard.requirePermission("analytics.activity.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      // Prefetched, never ensured: an unreachable store failed the loader, and the route's
      // error screen replaced the panel's own "could not be loaded" (`CR.45`).
      context.queryClient.prefetchQuery(AnalyticsQueries.activity(context.api, 30)),
    ]),
  component: Analytics,
});

function Analytics() {
  const { t } = useMessages("analytics");

  return (
    <main>
      <h1>{t("analytics.title")}</h1>
      <p>{t("analytics.subtitle")}</p>
      <ActivityTrendPanel />
    </main>
  );
}
