import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  type ClientNamespace,
  EmptyState,
  Page,
  type ProjectDto,
  ProjectQueries,
  ProjectSettings,
  useApiClient,
  useAppQuery,
  useMessages,
  z,
} from "~/import.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = [
  "project",
  "team",
  "member",
  "scan",
  "graph",
] as const satisfies readonly ClientNamespace[];

const Search = z.object({
  tab: z.enum(["general", "repositories", "access", "delete"]).optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/_authenticated/p/$project/settings")({
  validateSearch: Search,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const { t } = useMessages("project");
  const { project: slug } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const client = useApiClient();
  const project = useAppQuery({ ...ProjectQueries.detail(client, slug), retry: false });

  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const data: ProjectDto | undefined = project.data;
  if (project.isPending) return null;
  if (!data) {
    return (
      <Page>
        <EmptyState icon="folder" title={t("project.notFound")} />
      </Page>
    );
  }

  return (
    <Page>
      <div>
        <Link
          to="/p/$project"
          params={{ project: slug }}
          className="text-sm text-fg-muted no-underline hover:text-fg"
        >
          {data.name}
        </Link>
        <h1 className="m-0 mt-1 text-2xl font-semibold">{t("project.settings")}</h1>
      </div>
      <ProjectTabs slug={slug} projectId={data.id} />
      <ProjectSettings
        project={data}
        tab={tab ?? "general"}
        onTab={(next) => void navigate({ search: { tab: next } })}
        onDeleted={() => void navigate({ to: "/projects" })}
      />
    </Page>
  );
}
