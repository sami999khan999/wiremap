import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Can,
  DataTable,
  EmptyState,
  type MemberDto,
  MemberQueries,
  Select,
  type TableColumn,
  type TeamDto,
  type TeamMemberDto,
  TeamMutations,
  TeamQueries,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

export interface TeamMembersPanelProps {
  readonly teamId: string;
  readonly onClose: () => void;
}

interface Row extends TeamMemberDto {
  readonly id: string;
}

export function TeamMembersPanel({ teamId, onClose }: TeamMembersPanelProps) {
  const { t } = useMessages("team");
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const members = useAppQuery(TeamQueries.members(client, teamId));
  const everyone = useAppQuery(MemberQueries.list(client, { limit: 100, offset: 0 }));
  const add = TeamMutations.useAddMember(client);
  const remove = TeamMutations.useRemoveMember(client);
  const [adding, setAdding] = useState<string | null>(null);
  const id = teamId as TeamDto["id"];

  // Annotated, as `MemberList` does: the procedure types are reconstructed through two
  // packages, and a break anywhere degrades to `any` silently.
  const current: readonly TeamMemberDto[] = members.data ?? [];
  const inTeam = new Set(current.map((member) => member.userId));
  const people: readonly MemberDto[] = everyone.data?.items ?? [];
  const addable = people.filter((member) => !inTeam.has(member.userId) && !member.deactivated);
  const rows: readonly Row[] = current.map((member) => ({
    ...member,
    id: member.userId,
  }));

  const columns: readonly TableColumn<Row>[] = [
    { key: "name", header: t("team.name"), cell: (row) => row.name },
    { key: "email", header: "", cell: (row) => <span className="text-fg-muted">{row.email}</span> },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Can permission="member.team.manage" capabilities={capabilities}>
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ teamId: id, userId: row.userId })}
          >
            {t("team.removeMember")}
          </Button>
        </Can>
      ),
    },
  ];

  const refusal = describe(add.error ?? remove.error);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-semibold">{t("team.members")}</h2>
        <Button variant="ghost" onClick={onClose}>
          ×
        </Button>
      </div>
      <Can permission="member.team.manage" capabilities={capabilities}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t("team.addMember")}
            value={adding}
            onValueChange={setAdding}
            options={addable.map((member) => ({
              value: member.userId,
              label: member.name || member.email,
            }))}
          />
          <Button
            disabled={!adding || add.isPending}
            onClick={() =>
              adding &&
              add.mutate(
                { teamId: id, userId: adding as MemberDto["userId"] },
                { onSuccess: () => setAdding(null) },
              )
            }
          >
            {t("team.addMember")}
          </Button>
        </div>
      </Can>
      {refusal ? <Callout tone="danger">{refusal.message}</Callout> : null}
      {members.isPending ? (
        <DataTable.Skeleton rows={2} columns={2} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("team.emptyMembers")} />
      ) : (
        <DataTable columns={columns} rows={rows} caption={t("team.members")} />
      )}
    </section>
  );
}
