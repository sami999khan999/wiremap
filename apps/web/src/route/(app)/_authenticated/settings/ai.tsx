import { createFileRoute } from "@tanstack/react-router";
import { AiSettingsForm, AskQueries, type ClientNamespace, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["ask"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/settings/ai")({
  beforeLoad: RouteGuard.requirePermission("organization.ai.manage"),
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    await Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(AskQueries.settings(context.api)),
    ]);
  },
  component: AiSettings,
});

function AiSettings() {
  const { t } = useMessages("ask");
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-2xl font-semibold">{t("ai.title")}</h1>
        <p className="m-0 mt-1 text-sm text-fg-muted">{t("ai.intro")}</p>
      </div>
      <AiSettingsForm />
    </section>
  );
}
