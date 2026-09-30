import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  DISMISSAL,
  useMessages,
  WidgetDefaultForm,
  WidgetQueries,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["widget"] as const satisfies readonly ClientNamespace[];

// An admin's page: which cards everyone in the org sees. Gated on the manage key; the form
// itself says the rollout is not on when the flag is off, rather than the route hiding.
export const Route = createFileRoute("/(app)/_authenticated/settings/widgets")({
  beforeLoad: RouteGuard.requirePermission("widget.default.manage"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.flags.includes(DISMISSAL)
        ? context.queryClient.ensureQueryData(WidgetQueries.preferences(context.api))
        : null,
    ]),
  component: WidgetSettings,
});

function WidgetSettings() {
  const { t } = useMessages("widget");

  return (
    <main>
      <h1>{t("widget.defaults.title")}</h1>
      <WidgetDefaultForm zone="dashboard.main" />
    </main>
  );
}
