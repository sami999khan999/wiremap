import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type ClientNamespace,
  EmptyState,
  Icon,
  type ProjectDto,
  ProjectQueries,
  useApiClient,
  useAppQuery,
  useCapabilities,
  useMessages,
} from "~/import.js";

const MESSAGES = ["project"] as const satisfies readonly ClientNamespace[];

// The project's own page. The graph explorer lands here in `WM7`; until a scan exists it
// names the repositories and says what comes next.
export const Route = createFileRoute("/(app)/_authenticated/p/$project/")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: ProjectPage,
});

function ProjectPage() {
  const { t } = useMessages("project");
  const { project: slug } = Route.useParams();
  const client = useApiClient();
  const capabilities = useCapabilities();
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

  const manages = (
    ["project.settings.manage", "project.access.manage", "project.delete"] as const
  ).some((key) => capabilities.can(key, data.id));

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
        {manages ? (
          <Link
            to="/p/$project/settings"
            params={{ project: slug }}
            className="flex items-center gap-1.5 text-sm text-fg-muted no-underline hover:text-fg"
          >
            <Icon name="settings" size={16} />
            {t("project.settings")}
          </Link>
        ) : null}
      </div>
      <EmptyState
        icon="graph"
        title={t("project.overview.noScans")}
        description={t("project.overview.noScans.description")}
      />
    </section>
  );
}
