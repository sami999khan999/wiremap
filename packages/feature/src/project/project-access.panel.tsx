import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  Field,
  type MemberDto,
  MemberQueries,
  PROJECT_ROLES,
  type ProjectDto,
  type ProjectGrantDto,
  ProjectMutations,
  ProjectQueries,
  type ProjectRole,
  Select,
  type TableColumn,
  type TeamDto,
  TeamQueries,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

// Who can open a project beyond its default, and with what role. A grantee is a member or a
// team of this organization; the picker offers both in one list, prefixed by kind.
export function ProjectAccessPanel({ project }: { readonly project: ProjectDto }) {
  const { t } = useMessages("project");
  const describe = useErrorMessage();
  const client = useApiClient();
  const grants = useAppQuery(ProjectQueries.access(client, project.id));
  const members = useAppQuery(MemberQueries.list(client, { limit: 100, offset: 0 }));
  const teams = useAppQuery(TeamQueries.list(client, { limit: 100, offset: 0 }));
  const save = ProjectMutations.useSaveGrant(client);
  const revoke = ProjectMutations.useRevokeGrant(client);
  const [grantee, setGrantee] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectRole>("project_viewer");

  // Annotated, as `MemberList` does: a break in the procedure types degrades to `any`.
  const people: readonly MemberDto[] = members.data?.items ?? [];
  const teamRows: readonly TeamDto[] = teams.data?.items ?? [];
  const current: readonly ProjectGrantDto[] = grants.data ?? [];
  const choices = [
    ...people
      .filter((member) => !member.deactivated)
      .map((member) => ({
        value: `user:${member.userId}`,
        label: `${member.name} · ${member.email}`,
        userId: member.userId,
        teamId: null,
      })),
    ...teamRows.map((team) => ({
      value: `team:${team.id}`,
      label: `${t("project.access.kind.team")}: ${team.name}`,
      userId: null,
      teamId: team.id,
    })),
  ];
  const options = choices.map(({ value, label }) => ({ value, label }));

  const columns: readonly TableColumn<ProjectGrantDto>[] = [
    { key: "name", header: t("project.access.grantee"), cell: (row) => row.name },
    {
      key: "kind",
      header: "",
      cell: (row) =>
        t(row.kind === "team" ? "project.access.kind.team" : "project.access.kind.user"),
    },
    { key: "role", header: t("project.access.role"), cell: (row) => t(`project.role.${row.role}`) },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="ghost"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate({ projectId: project.id, grantId: row.id })}
        >
          {t("project.access.revoke")}
        </Button>
      ),
    },
  ];

  const refusal = describe(save.error ?? revoke.error);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="m-0 text-sm text-fg-muted">
        {project.visibility === "org"
          ? t("project.access.orgDefault", { role: t(`project.role.${project.defaultRole}`) })
          : t("project.access.restricted")}
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const choice = choices.find((each) => each.value === grantee);
          if (!choice) return;
          save.mutate(
            { projectId: project.id, userId: choice.userId, teamId: choice.teamId, role },
            { onSuccess: () => setGrantee(null) },
          );
        }}
      >
        <Field label={t("project.access.grantee")} htmlFor="project-grantee">
          <Select
            id="project-grantee"
            className="min-w-64"
            label={t("project.access.grantee")}
            value={grantee}
            onValueChange={setGrantee}
            options={options}
          />
        </Field>
        <Field label={t("project.access.role")} htmlFor="project-grant-role">
          <Select
            id="project-grant-role"
            label={t("project.access.role")}
            value={role}
            onValueChange={(value) =>
              setRole(PROJECT_ROLES.find((each) => each === value) ?? "project_viewer")
            }
            options={PROJECT_ROLES.map((each) => ({
              value: each,
              label: t(`project.role.${each}`),
            }))}
          />
        </Field>
        <Button type="submit" disabled={!grantee || save.isPending}>
          {t("project.access.grant")}
        </Button>
      </form>
      {refusal ? <Callout tone="danger">{refusal.message}</Callout> : null}
      {grants.isPending ? (
        <DataTable.Skeleton rows={2} columns={3} />
      ) : current.length === 0 ? (
        <EmptyState title={t("project.access.empty")} />
      ) : (
        <DataTable
          columns={columns}
          rows={grants.data ?? []}
          caption={t("project.settings.access")}
        />
      )}
    </div>
  );
}
