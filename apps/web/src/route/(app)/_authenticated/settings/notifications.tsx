import { createFileRoute } from "@tanstack/react-router";
import { type ClientNamespace, NotificationPreferenceForm, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["notification"] as const satisfies readonly ClientNamespace[];

// Gated on the read key rather than the update one: somebody who may see their inbox may
// see how it reaches them, and the form's own buttons are what the update key gates.
export const Route = createFileRoute("/(app)/_authenticated/settings/notifications")({
  beforeLoad: RouteGuard.requirePermission("notification.inbox.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: NotificationSettings,
});

function NotificationSettings() {
  const { t } = useMessages("notification");

  return (
    <main>
      <h1>{t("notification.preference.title")}</h1>
      <NotificationPreferenceForm />
    </main>
  );
}
