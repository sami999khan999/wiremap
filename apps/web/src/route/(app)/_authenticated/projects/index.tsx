import { createFileRoute } from "@tanstack/react-router";
import { type ClientNamespace, ProjectList, ProjectQueries, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";
import { ProjectLink } from "~/route/-project-link.js";

const MESSAGES = ["project"] as const satisfies readonly ClientNamespace[];
const PAGE = { limit: 100, offset: 0 } as const;

export const Route = createFileRoute("/(app)/_authenticated/projects/")({
  beforeLoad: RouteGuard.requirePermission("member.read"),
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    await Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(ProjectQueries.list(context.api, PAGE)),
    ]);
  },
  component: Projects,
});

function Projects() {
  const { t } = useMessages("project");
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div>
        <h1 className="m-0 text-2xl font-semibold">{t("project.title")}</h1>
        <p className="m-0 mt-1 text-sm text-fg-muted">{t("project.intro")}</p>
      </div>
      <ProjectList renderLink={ProjectLink.render} newHref="/projects/new" />
    </section>
  );
}
