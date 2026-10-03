import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  ProjectAccessMatrix,
  ProjectQueries,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["project"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/settings/access")({
  beforeLoad: RouteGuard.requirePermission("project.access.overview"),
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    await Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(ProjectQueries.accessOverview(context.api)),
    ]);
  },
  component: Access,
});

function Access() {
  const { t } = useMessages("project");
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-2xl font-semibold">{t("project.accessOverview.title")}</h1>
        <p className="m-0 mt-1 text-sm text-fg-muted">{t("project.accessOverview.intro")}</p>
      </div>
      <ProjectAccessMatrix />
    </section>
  );
}
