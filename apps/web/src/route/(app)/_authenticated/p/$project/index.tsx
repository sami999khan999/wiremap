import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  type ClientNamespace,
  EmptyState,
  type ExplorerState,
  ExplorerUrl,
  GraphExplorer,
  type GraphLinkDto,
  Icon,
  type ProjectDto,
  ProjectQueries,
  type ScanDto,
  ScanQueries,
  Select,
  useApiClient,
  useAppQuery,
  useMemo,
  useMessages,
  useSession,
  ViewsMenu,
  z,
} from "~/import.js";
import { elkLayout } from "~/route/-graph-layout.js";
import { ProjectTabs } from "~/route/-project-tabs.js";

const MESSAGES = ["project", "scan", "graph"] as const satisfies readonly ClientNamespace[];

// Every piece of the explorer's state is in the URL, so any view is a link to send.
const Search = z.object({
  scan: z.uuid().optional().catch(undefined),
  depth: z.coerce.number().int().min(1).max(4).optional().catch(undefined),
  open: z.string().optional().catch(undefined),
  role: z.string().optional().catch(undefined),
  folder: z.string().optional().catch(undefined),
  repo: z.string().optional().catch(undefined),
  sel: z.string().optional().catch(undefined),
  impact: z.coerce.boolean().optional().catch(undefined),
});

type SearchState = z.infer<typeof Search>;

export const Route = createFileRoute("/(app)/_authenticated/p/$project/")({
  validateSearch: Search,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectPage,
});

// The scan picked rides beside the explorer's own state.
const toSearch = (state: ExplorerState, scan: string | undefined): SearchState => ({
  ...(scan ? { scan } : {}),
  ...ExplorerUrl.toSearch(state),
});

function Explorer({ project }: { readonly project: ProjectDto }) {
  const { t } = useMessages("graph");
  const scanCopy = useMessages("scan");
  const client = useApiClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user } = useSession();
  const state = useMemo(() => ExplorerUrl.toState(search), [search]);
  const scanId = (search.scan as ScanDto["id"] | undefined) ?? null;
  const link = useAppQuery(ScanQueries.graph(client, project.id, scanId));
  const linkData: GraphLinkDto | undefined = link.data;
  const document = useAppQuery({
    ...ScanQueries.document(linkData ?? { scanId: "" as ScanDto["id"], url: "" }),
    enabled: linkData !== undefined,
  });
  const scans = useAppQuery(ScanQueries.list(client, project.id, { limit: 50, offset: 0 }));
  const succeeded: readonly ScanDto[] = (scans.data?.items ?? []).filter(
    (scan) => scan.state === "succeeded",
  );

  if (link.isPending) return <p className="m-0 px-4 text-sm text-fg-muted">{t("graph.loading")}</p>;
  if (!linkData) {
    return (
      <EmptyState
        icon="graph"
        title={scanCopy.t("scan.empty")}
        description={scanCopy.t("scan.empty.description")}
      />
    );
  }
  if (document.isPending)
    return <p className="m-0 px-4 text-sm text-fg-muted">{t("graph.loading")}</p>;
  if (!document.data) {
    const unsupported = document.error?.message === "graph-version";
    return (
      <EmptyState icon="graph" title={unsupported ? t("graph.unsupported") : t("graph.failed")} />
    );
  }

  return (
    <GraphExplorer
      document={document.data}
      state={state}
      onState={(change) =>
        void navigate({ search: toSearch({ ...state, ...change }, search.scan), replace: true })
      }
      layout={elkLayout}
      toolbar={
        <>
          <ViewsMenu
            projectId={project.id}
            state={new URLSearchParams(
              Object.entries(toSearch(state, search.scan)).map(([key, value]) => [
                key,
                String(value),
              ]),
            ).toString()}
            currentUserId={user?.id ?? null}
            renderLink={(saved, content, attributes) => (
              <Link
                to="/p/$project"
                params={{ project: project.slug }}
                search={Search.parse(Object.fromEntries(new URLSearchParams(saved)))}
                className={attributes.className}
              >
                {content}
              </Link>
            )}
          />
          {succeeded.length > 1 ? (
            <div className="w-64">
              <Select
                label={t("graph.scan")}
                value={search.scan ?? ""}
                onValueChange={(value) => void navigate({ search: value ? { scan: value } : {} })}
                options={[
                  { value: "", label: t("graph.scan.latest") },
                  ...succeeded.map((scan) => ({
                    value: scan.id,
                    label: `${scan.branch ?? scanCopy.t(`scan.trigger.${scan.trigger}`)} · ${scan.commitSha?.slice(0, 7) ?? scan.queuedAt.toISOString().slice(0, 16)}`,
                  })),
                ]}
              />
            </div>
          ) : null}
        </>
      }
    />
  );
}

// The project's own page: the graph explorer under its name and tabs.
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
    <section className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="m-0 text-xl font-semibold">{data.name}</h1>
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
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
      </div>
      <Explorer project={data} />
    </section>
  );
}
