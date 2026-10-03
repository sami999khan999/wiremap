import { useMessages } from "../i18n/index.js";
import {
  DataTable,
  dataTableClassName,
  EmptyState,
  type ProjectAccessOverviewDto,
  ProjectQueries,
  type ProjectRole,
  RoleDot,
  type RoleTone,
  useApiClient,
  useAppQuery,
} from "../import.js";

type Cell = ProjectAccessOverviewDto["cells"][number];

const TONE: Readonly<Record<ProjectRole, RoleTone>> = {
  project_admin: "primary",
  project_editor: "cool",
  project_viewer: "neutral",
};

// Projects across, members down: the role each person ends up with and, on hover, why.
// The table scrolls inside its own box, so a wide tenant never widens the page.
export function ProjectAccessMatrix() {
  const { t } = useMessages("project");
  const client = useApiClient();
  const overview = useAppQuery(ProjectQueries.accessOverview(client));
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const data: ProjectAccessOverviewDto | undefined = overview.data;

  if (overview.isPending) return <DataTable.Skeleton rows={4} columns={3} />;
  if (!data || data.projects.length === 0)
    return <EmptyState icon="folder" title={t("project.accessOverview.empty")} />;

  const cells = new Map<string, Cell>(
    data.cells.map((cell) => [`${cell.projectId}:${cell.userId}`, cell]),
  );
  const why = (cell: Cell) =>
    cell.via === "team"
      ? t("project.accessOverview.via.team", { team: cell.teamName ?? "" })
      : t(`project.accessOverview.via.${cell.via}`);

  return (
    <div className="overflow-x-auto">
      <table className={dataTableClassName.table}>
        <caption className="sr-only">{t("project.accessOverview.title")}</caption>
        <thead>
          <tr>
            <th scope="col" className={dataTableClassName.header} />
            {data.projects.map((project) => (
              <th key={project.id} scope="col" className={dataTableClassName.header}>
                {project.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.members.map((member) => (
            <tr key={member.userId}>
              <th scope="row" className={`${dataTableClassName.cell} text-start font-normal`}>
                <span className="block font-medium">{member.name}</span>
                <span className="block text-xs text-fg-muted">{member.email}</span>
              </th>
              {data.projects.map((project) => {
                const cell = cells.get(`${project.id}:${member.userId}`);
                return (
                  <td key={project.id} className={dataTableClassName.cell}>
                    {cell ? (
                      <span
                        className="inline-flex items-center gap-2 whitespace-nowrap"
                        title={why(cell)}
                      >
                        <RoleDot tone={TONE[cell.role]} />
                        {t(`project.role.${cell.role}`)}
                        <span className="sr-only">: {why(cell)}</span>
                      </span>
                    ) : (
                      <span className="text-fg-muted">{t("project.accessOverview.none")}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
