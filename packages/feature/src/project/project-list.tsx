import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  buttonClassName,
  Can,
  Card,
  CardGrid,
  DataTable,
  EmptyState,
  type LinkAttributes,
  type ProjectDto,
  ProjectQueries,
  type ReactNode,
  StatusBadge,
  useApiClient,
  useAppQuery,
} from "../import.js";

export interface ProjectListProps {
  // The router's link, since `feature` has none: `/p/<slug>` and the new-project page.
  readonly renderLink: (href: string, content: ReactNode, attributes: LinkAttributes) => ReactNode;
  readonly newHref: string;
}

// Only the projects the viewer may read: the server filters, so nothing here hides rows.
export function ProjectList({ renderLink, newHref }: ProjectListProps) {
  const { t } = useMessages("project");
  const client = useApiClient();
  const capabilities = useCapabilities();
  const projects = useAppQuery(ProjectQueries.list(client, { limit: 100, offset: 0 }));

  const create = (
    <Can permission="project.create" capabilities={capabilities}>
      {renderLink(newHref, t("project.new"), {
        className: buttonClassName("primary", "no-underline"),
      })}
    </Can>
  );

  if (projects.isPending) return <DataTable.Skeleton rows={3} columns={2} />;
  // Annotated, as `MemberList` does: the procedure types cross two packages, and a break
  // anywhere degrades to `any` silently.
  const items: readonly ProjectDto[] = projects.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon="folder"
        title={t("project.empty")}
        description={t("project.empty.description")}
        action={create}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{create}</div>
      <CardGrid>
        {items.map((project) => (
          <Card
            key={project.id}
            icon="graph"
            title={project.name}
            description={project.description ?? undefined}
            href={`/p/${project.slug}`}
            renderLink={renderLink}
          >
            <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span>{t("project.repositoryCount", { count: project.repositories.length })}</span>
              {project.visibility === "restricted" ? (
                <StatusBadge tone="neutral">{t("project.visibility.restricted")}</StatusBadge>
              ) : null}
            </span>
          </Card>
        ))}
      </CardGrid>
    </div>
  );
}
