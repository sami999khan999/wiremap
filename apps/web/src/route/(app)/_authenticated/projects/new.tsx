import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ClientNamespace, Page, ProjectCreateForm, useMessages, z } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["project"] as const satisfies readonly ClientNamespace[];

// `/api/github/setup` sends the installer back here with the outcome.
const Search = z.object({ github: z.enum(["connected", "failed"]).optional().catch(undefined) });

export const Route = createFileRoute("/(app)/_authenticated/projects/new")({
  validateSearch: Search,
  beforeLoad: RouteGuard.requirePermission("project.create"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: NewProject,
});

function NewProject() {
  const { t } = useMessages("project");
  const navigate = useNavigate();
  const { github } = Route.useSearch();
  return (
    <Page width="narrow">
      <h1 className="m-0 text-2xl font-semibold">{t("project.new")}</h1>
      <ProjectCreateForm
        {...(github ? { githubResult: github } : {})}
        onCreated={(slug) => void navigate({ to: "/p/$project", params: { project: slug } })}
      />
    </Page>
  );
}
