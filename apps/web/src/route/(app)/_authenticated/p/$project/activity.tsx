import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  EmptyState,
  Page,
  ProjectActivityList,
  type ProjectDto,
  ProjectQueries,
  useApiClient,
  useAppQuery,
  useMessages,
} from "~/import.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = [
  "project",
  "scan",
  "graph",
  "activity",
] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/p/$project/activity")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectActivity,
});

function ProjectActivity() {
  const { t } = useMessages("project");
  const { project: slug } = Route.useParams();
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
      <h1 className="m-0 text-2xl font-semibold">{data.name}</h1>
      <ProjectTabs slug={slug} projectId={data.id} />
      <ProjectActivityList projectId={data.id} />
    </Page>
  );
}
