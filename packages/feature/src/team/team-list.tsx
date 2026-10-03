import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  AlertDialog,
  Button,
  Callout,
  Can,
  DataTable,
  EmptyState,
  Field,
  Input,
  type TableColumn,
  type TeamDto,
  TeamMutations,
  TeamQueries,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

export interface TeamListProps {
  // Opens one team's members; the route keeps which in the URL.
  readonly onOpen: (teamId: string) => void;
}

export function TeamList({ onOpen }: TeamListProps) {
  const { t } = useMessages("team");
  const { t: common } = useMessages("common");
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const teams = useAppQuery(TeamQueries.list(client, { limit: 100, offset: 0 }));
  const create = TeamMutations.useCreate(client);
  const remove = TeamMutations.useRemove(client);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deleting, setDeleting] = useState<TeamDto | null>(null);

  const columns: readonly TableColumn<TeamDto>[] = [
    {
      key: "name",
      header: t("team.name"),
      cell: (row) => (
        <Button variant="ghost" onClick={() => onOpen(row.id)}>
          {row.name}
        </Button>
      ),
    },
    { key: "description", header: t("team.description"), cell: (row) => row.description ?? "" },
    {
      key: "members",
      header: t("team.members"),
      cell: (row) => t("team.memberCount", { count: row.memberCount }),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Can permission="member.team.manage" capabilities={capabilities}>
          <Button variant="ghost" onClick={() => setDeleting(row)}>
            {t("team.delete")}
          </Button>
        </Can>
      ),
    },
  ];

  const refusal = describe(create.error ?? remove.error);

  return (
    <div className="flex flex-col gap-4">
      <Can permission="member.team.manage" capabilities={capabilities}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === "") return;
            create.mutate(
              { name: name.trim(), description: description.trim() || null },
              {
                onSuccess: () => {
                  setName("");
                  setDescription("");
                },
              },
            );
          }}
        >
          <Field label={t("team.name")} htmlFor="team-name">
            <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t("team.description")} htmlFor="team-description">
            <Input
              value={description}
              maxLength={280}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {t("team.create")}
          </Button>
        </form>
      </Can>
      {refusal ? (
        <Callout tone="danger">
          {refusal.envelope.code === "CONFLICT" ? t("team.nameTaken") : refusal.message}
        </Callout>
      ) : null}
      {teams.isPending ? (
        <DataTable.Skeleton rows={2} columns={3} />
      ) : (teams.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t("team.empty")} />
      ) : (
        <DataTable columns={columns} rows={teams.data?.items ?? []} caption={t("team.title")} />
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("team.delete")}
        description={deleting ? t("team.delete.confirm", { name: deleting.name }) : undefined}
        confirmLabel={t("team.delete")}
        cancelLabel={common("action.cancel")}
        onConfirm={() => {
          if (deleting) remove.mutate({ teamId: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
}
