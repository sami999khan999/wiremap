import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  type ClientNamespace,
  CompareView,
  EmptyState,
  Page,
  type ProjectDto,
  ProjectQueries,
  type ScanDto,
  ScanQueries,
  Select,
  useApiClient,
  useAppQuery,
  useMessages,
  z,
} from "~/import.js";
import { pathLink, useProjectGraph } from "~/route/-project-graph.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = ["project", "scan", "graph"] as const satisfies readonly ClientNamespace[];

const Search = z.object({
  a: z.uuid().optional().catch(undefined),
  b: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/_authenticated/p/$project/compare")({
  validateSearch: Search,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectCompare,
});

function Compare({ project }: { readonly project: ProjectDto }) {
  const { t } = useMessages("graph");
  const scanCopy = useMessages("scan");
  const client = useApiClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const scans = useAppQuery(ScanQueries.list(client, project.id, { limit: 50, offset: 0 }));
  const succeeded: readonly ScanDto[] = (scans.data?.items ?? []).filter(
    (scan) => scan.state === "succeeded",
  );
  // Defaults: the latest scan against the one before it.
  const after = (search.b as ScanDto["id"] | undefined) ?? succeeded[0]?.id ?? null;
  const before = (search.a as ScanDto["id"] | undefined) ?? succeeded[1]?.id ?? null;
  const left = useProjectGraph(project.id, before);
  const right = useProjectGraph(project.id, after);
  const options = succeeded.map((scan) => ({
    value: scan.id,
    label: `${scan.branch ?? scanCopy.t(`scan.trigger.${scan.trigger}`)} · ${scan.commitSha?.slice(0, 7) ?? scan.queuedAt.toISOString().slice(0, 16).replace("T", " ")}`,
  }));

  if (succeeded.length < 2) return <EmptyState icon="graph" title={t("compare.pick")} />;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-fg-muted">{t("compare.intro")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={t("compare.before")}
          value={before}
          onValueChange={(value) => void navigate({ search: { ...search, a: value } })}
          options={options}
        />
        <Select
          label={t("compare.after")}
          value={after}
          onValueChange={(value) => void navigate({ search: { ...search, b: value } })}
          options={options}
        />
      </div>
      {left.graph && right.graph ? (
        <CompareView before={left.graph} after={right.graph} renderPath={pathLink(project.slug)} />
      ) : (
        <p className="m-0 text-sm text-fg-muted">{t("graph.loading")}</p>
      )}
    </div>
  );
}

function ProjectCompare() {
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
      <Compare project={data} />
    </Page>
  );
}
