import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Can,
  DataTable,
  EmptyState,
  Input,
  type RoleDto,
  RoleMutations,
  RoleQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";
import { useRoleFailure } from "./use-role-failure.js";

export interface RoleListProps {
  // Paged rather than unbounded: `Pagination.query` caps `limit` at 100 in the schema.
  readonly limit?: number;
}

interface RoleRow extends RoleDto {
  readonly id: RoleDto["id"];
}

// Names and lifecycle. What each role *grants* is `RoleMatrix`, because the two answer
// different questions and one table asking both is unreadable at twenty permissions.
export function RoleList({ limit = 25 }: RoleListProps) {
  const { t } = useMessages("role");
  const failureCopy = useRoleFailure();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const roles = useAppQuery(RoleQueries.list(client, { limit, offset: 0 }));
  const rename = RoleMutations.useUpdate(client);
  const remove = RoleMutations.useDelete(client);

  const [editing, setEditing] = useState<RoleDto["id"] | null>(null);
  const [draft, setDraft] = useState("");

  const rows = useMemo<readonly RoleRow[]>(() => {
    // Annotated rather than inferred: the client's procedure types are reconstructed
    // through two packages, and a break anywhere degrades to `any` silently.
    const items: readonly RoleDto[] = roles.data?.items ?? [];
    return items.map((role) => ({ ...role, id: role.id }));
  }, [roles.data]);

  const columns = useMemo<readonly TableColumn<RoleRow>[]>(
    () => [
      {
        key: "name",
        header: t("role.column.name"),
        cell: (row) =>
          row.id === editing ? (
            <>
              <Input
                value={draft}
                aria-label={t("role.rename.title", { name: row.name })}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button
                disabled={rename.isPending || draft.trim() === ""}
                onClick={() =>
                  rename.mutate(
                    { roleId: row.id, name: draft, description: row.description },
                    { onSuccess: () => setEditing(null) },
                  )
                }
              >
                {t("role.action.save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t("role.action.cancel")}
              </Button>
            </>
          ) : (
            <>
              {row.name}{" "}
              {row.isSystem ? (
                <StatusBadge tone="neutral">{t("role.badge.system")}</StatusBadge>
              ) : null}
            </>
          ),
      },
      { key: "key", header: t("role.create.key"), cell: (row) => <code>{row.key}</code> },
      {
        key: "exceptions",
        header: "",
        // A role review sees the drift here, without opening each member.
        cell: (row) =>
          row.membersWithExceptions ? (
            <StatusBadge tone="warning">
              {row.membersWithExceptions === 1
                ? t("role.exceptions.one")
                : t("role.exceptions.other", { count: row.membersWithExceptions })}
            </StatusBadge>
          ) : null,
      },
      {
        key: "actions",
        header: t("role.column.actions"),
        cell: (row) => (
          <Can permission="rbac.role.manage" capabilities={capabilities}>
            {
              // Hidden for a seeded row, because the use-case refuses it: the seed
              // rewrites those on every deploy, so an edit would vanish without a word.
              row.isSystem || row.id === editing ? null : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(row.id);
                      setDraft(row.name);
                    }}
                  >
                    {t("role.action.rename")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ roleId: row.id })}
                  >
                    {t("role.action.delete")}
                  </Button>
                </>
              )
            }
          </Can>
        ),
      },
    ],
    [t, capabilities, editing, draft, rename, remove],
  );

  const failure = failureCopy(rename.error ?? remove.error);

  if (roles.isPending) return <DataTable.Skeleton rows={4} columns={3} />;
  // A failed list rendered as "no roles yet" is the one answer this page must not give
  // when it does not know.
  if (roles.isError) return <Callout tone="danger">{failureCopy(roles.error)}</Callout>;
  if (rows.length === 0) return <EmptyState title={t("role.empty")} />;

  return (
    <>
      {failure ? <Callout tone="danger">{failure}</Callout> : null}
      <DataTable columns={columns} rows={rows} caption={t("role.title")} />
    </>
  );
}
