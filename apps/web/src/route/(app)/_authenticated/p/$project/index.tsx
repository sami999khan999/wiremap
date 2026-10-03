import { createFileRoute } from "@tanstack/react-router";
import {
  Callout,
  type ClientNamespace,
  EmptyState,
  type GraphLinkDto,
  Icon,
  type ProjectDto,
  ProjectQueries,
  ScanQueries,
  useApiClient,
  useAppQuery,
  useMessages,
} from "~/import.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = ["project", "scan"] as const satisfies readonly ClientNamespace[];

// The project's own page. The graph explorer lands here in `WM7`; until then it names the
// repositories and summarises the latest scan, the partial-graph line included.
export const Route = createFileRoute("/(app)/_authenticated/p/$project/")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectPage,
});

function LatestScan({ projectId }: { readonly projectId: ProjectDto["id"] }) {
  const { t } = useMessages("scan");
  const client = useApiClient();
  const graph = useAppQuery(ScanQueries.graph(client, projectId, null));
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const data: GraphLinkDto | undefined = graph.data;
  if (graph.isPending) return null;
  if (!data) {
    return (
      <EmptyState icon="graph" title={t("scan.empty")} description={t("scan.empty.description")} />
    );
  }
  const { counts } = data;
  const percent = counts.total === 0 ? 100 : Math.round((counts.resolved / counts.total) * 100);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 text-base font-semibold">{t("scan.latest")}</h2>
      <p className="m-0 text-sm text-fg-muted">{t("scan.counts", { ...counts })}</p>
      {counts.resolved < counts.total ? (
        <Callout tone="warning">
          {t("scan.partial", { resolved: counts.resolved, total: counts.total, percent })}
        </Callout>
      ) : (
        <p className="m-0 text-sm text-fg-muted">{t("scan.complete", { total: counts.total })}</p>
      )}
    </div>
  );
}

function ProjectPage() {
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
      <div className="min-w-0">
        <h1 className="m-0 text-2xl font-semibold">{data.name}</h1>
        {data.description ? (
          <p className="m-0 mt-1 text-sm text-fg-muted">{data.description}</p>
        ) : null}
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-3 p-0">
          {data.repositories.map((repository) => (
            <li
              key={repository.id}
              className="flex items-center gap-1.5 font-mono text-xs text-fg-muted"
            >
              <Icon name="github" size={14} />
              {repository.fullName}
            </li>
          ))}
        </ul>
      </div>
      <ProjectTabs slug={slug} projectId={data.id} />
      <LatestScan projectId={data.id} />
    </section>
  );
}
