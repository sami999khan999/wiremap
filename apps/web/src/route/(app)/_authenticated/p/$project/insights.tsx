import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  type ClientNamespace,
  EmptyState,
  ImpactExplorer,
  InsightsOverview,
  type ProjectDto,
  ProjectQueries,
  useApiClient,
  useAppQuery,
  useMessages,
  z,
} from "~/import.js";
import { GraphGate, pathLink, useProjectGraph } from "~/route/-project-graph.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = ["project", "scan", "graph"] as const satisfies readonly ClientNamespace[];

// The file being looked at under "Change impact", in the URL so it can be sent.
const Search = z.object({ file: z.string().optional().catch(undefined) });

export const Route = createFileRoute("/(app)/_authenticated/p/$project/insights")({
  validateSearch: Search,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectInsights,
});

function Insights({ project }: { readonly project: ProjectDto }) {
  const { t } = useMessages("graph");
  const { file } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { pending, graph, missing } = useProjectGraph(project.id, null);
  const link = pathLink(project.slug);
  return (
    <GraphGate pending={pending} missing={missing}>
      {graph ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-fg-muted">{t("insight.intro")}</p>
          <ImpactExplorer
            document={graph}
            path={file ?? null}
            onPath={(path) => void navigate({ search: path ? { file: path } : {}, replace: true })}
            renderPath={link}
          />
          <InsightsOverview document={graph} renderPath={link} />
        </div>
      ) : null}
    </GraphGate>
  );
}

function ProjectInsights() {
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
      <Insights project={data} />
    </section>
  );
}
