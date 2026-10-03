import { createFileRoute } from "@tanstack/react-router";
import { type ClientNamespace, useMessages, WebhookPanel, WebhookQueries } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["webhook"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/settings/webhooks")({
  beforeLoad: RouteGuard.requirePermission("organization.webhook.manage"),
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    await Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(WebhookQueries.list(context.api)),
    ]);
  },
  component: Webhooks,
});

function Webhooks() {
  const { t } = useMessages("webhook");
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-2xl font-semibold">{t("webhook.title")}</h1>
        <p className="m-0 mt-1 max-w-2xl text-sm text-fg-muted">{t("webhook.intro")}</p>
      </div>
      <WebhookPanel />
    </section>
  );
}
