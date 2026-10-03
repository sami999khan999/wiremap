import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  EmptyState,
  type ProjectDto,
  ProjectQueries,
  ScanHistory,
  useApiClient,
  useAppQuery,
  useMessages,
} from "~/import.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = ["project", "scan", "graph"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/p/$project/scans")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectScans,
});

function ProjectScans() {
  const { t } = useMessages("project");
  const { project: slug } = Route.useParams();
  const client = useApiClient();
  const project = useAppQuery({ ...ProjectQueries.detail(client, slug), retry: false });
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const data: ProjectDto | undefined = project.data;
  if (project.isPending) return null;
  if (!data) {
    return (
      <section className="mx-auto w-full max-w-6xl px-4 py-6">
        <EmptyState icon="folder" title={t("project.notFound")} />
      </section>
    );
  }
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <h1 className="m-0 text-2xl font-semibold">{data.name}</h1>
      <ProjectTabs slug={slug} projectId={data.id} />
      <ScanHistory projectId={data.id} />
    </section>
  );
}
