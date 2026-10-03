import { createFileRoute } from "@tanstack/react-router";
import { ActivityList, type ClientNamespace, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["activity"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/settings/audit")({
  beforeLoad: RouteGuard.requirePermission("audit.log.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Audit,
});

function Audit() {
  const { t } = useMessages("activity");

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-2xl font-semibold">{t("activity.title")}</h1>
        <p className="m-0 mt-1 text-sm text-fg-muted">{t("activity.intro")}</p>
      </div>
      <ActivityList />
    </section>
  );
}
