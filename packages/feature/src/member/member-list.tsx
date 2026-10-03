import { useCapabilities, useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  AlertDialog,
  Button,
  Callout,
  Can,
  DataTable,
  DateFormat,
  EmptyState,
  type MemberDto,
  MemberMutations,
  MemberQueries,
  type RoleDto,
  Select,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";
import { EffectivePermissionsInspector } from "../rbac/index.js";
import { useAssignableRoles } from "./use-assignable-roles.js";

export interface MemberListProps {
  // Paged rather than unbounded: `Pagination.query` caps `limit` at 100 in the schema.
  readonly limit?: number;
  // Given, the row opens the route's access panel; absent, the inline inspector as before.
  // A prop, because `feature` may not import routing.
  readonly onOpenAccess?: (userId: string) => void;
}

// A row needs a stable `id` for `DataTable`; the member's user id is that.
interface MemberRow extends MemberDto {
  readonly id: string;
}

export function MemberList({ limit = 25, onOpenAccess }: MemberListProps) {
  const { t } = useMessages("member");
  // Renders the code the server sent rather than one generic sentence: a 403 and a
  // 409 are different things to be told.
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const { user } = useSession();
  const members = useAppQuery(MemberQueries.list(client, { limit, offset: 0 }));
  const deactivate = MemberMutations.useDeactivate(client);
  const reactivate = MemberMutations.useReactivate(client);
  const changeRole = MemberMutations.useChangeRole(client);
  const remove = MemberMutations.useRemove(client);
  // The row whose removal is being confirmed. One at a time, like a role change.
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const roles = useAssignableRoles();
  // One pending change at a time, confirmed by a second press: a demotion is one click from
  // the list, and the select alone would apply whatever the pointer slipped onto.
  const [changing, setChanging] = useState<{ userId: string; roleId: string } | null>(null);
  // One row at a time: the inspector issues a query, and opening every row would issue
  // one per member on a page of twenty-five.
  const [inspecting, setInspecting] = useState<MemberDto | null>(null);

  // The roles a member can be moved to, with their current one kept so the select names it.
  const rolesFor = (row: MemberRow): readonly RoleDto[] => {
    const current = roles.all.find((role) => role.id === row.roleId);
    const offered = roles.assignable;
    return current && !offered.includes(current) ? [current, ...offered] : offered;
  };

  const rows = useMemo<readonly MemberRow[]>(() => {
    // Annotated rather than inferred: the client's procedure types are reconstructed
    // through two packages, and a break anywhere degrades to `any` silently.
    const items: readonly MemberDto[] = members.data?.items ?? [];
    return items.map((member) => ({ ...member, id: member.userId }));
  }, [members.data]);

  const columns = useMemo<readonly TableColumn<MemberRow>[]>(
    () => [
      {
        key: "name",
        header: t("member.column.name"),
        cell: (row) => (
          <>
            {row.name}{" "}
            {row.roleKey === "owner" ? (
              <StatusBadge tone="neutral">{t("member.badge.owner")}</StatusBadge>
            ) : null}{" "}
            {row.deactivated ? (
              <StatusBadge tone="warning">{t("member.badge.deactivated")}</StatusBadge>
            ) : null}{" "}
            {
              // Not the admin's to lift, so it says whose lock it is instead of offering one.
            }
            {row.suspended ? (
              <StatusBadge tone="danger">{t("member.badge.suspended")}</StatusBadge>
            ) : null}
          </>
        ),
      },
      { key: "email", header: t("member.column.email"), cell: (row) => row.email },
      {
        key: "role",
        header: t("member.column.role"),
        // "Accountant + 2 exceptions": the drift, read from the list without opening anyone.
        cell: (row) =>
          row.exceptions === 0 ? (
            row.roleName
          ) : (
            <>
              {row.roleName}{" "}
              <StatusBadge tone="warning">
                {row.exceptions === 1
                  ? t("member.exception.one")
                  : t("member.exception.other", { count: row.exceptions })}
              </StatusBadge>
            </>
          ),
      },
      {
        key: "joined",
        header: t("member.column.joined"),
        cell: (row) => DateFormat.day(row.joinedAt),
      },
      {
        key: "actions",
        header: t("member.column.actions"),
        cell: (row) => (
          <>
            <Can permission="rbac.effective.inspect" capabilities={capabilities}>
              <Button
                variant="ghost"
                onClick={() => (onOpenAccess ? onOpenAccess(row.userId) : setInspecting(row))}
              >
                {onOpenAccess ? t("member.action.access") : t("member.action.inspect")}
              </Button>
            </Can>
            <Can permission="member.role.change" capabilities={capabilities}>
              {
                // Not on your own row, and not on someone whose role holds a key you lack:
                // the use-case refuses both, so the control would only ever fail.
                row.userId === user?.id ||
                !roles.canAct(roles.all.find((role) => role.id === row.roleId)) ? null : (
                  <span className="inline-flex items-center gap-2">
                    <Select
                      id={`member-role-${row.userId}`}
                      label={t("member.action.changeRole")}
                      value={changing?.userId === row.userId ? changing.roleId : row.roleId}
                      onValueChange={(roleId) =>
                        setChanging(roleId === row.roleId ? null : { userId: row.userId, roleId })
                      }
                      options={rolesFor(row).map((role) => ({ value: role.id, label: role.name }))}
                    />
                    {changing?.userId === row.userId ? (
                      <>
                        <Button
                          disabled={changeRole.isPending}
                          onClick={() =>
                            changeRole.mutate(
                              { userId: row.userId, roleId: changing.roleId as RoleDto["id"] },
                              { onSuccess: () => setChanging(null) },
                            )
                          }
                        >
                          {t("member.action.changeRole")}
                        </Button>
                        <Button variant="ghost" onClick={() => setChanging(null)}>
                          {t("member.action.cancel")}
                        </Button>
                      </>
                    ) : null}
                  </span>
                )
              }
            </Can>
            <Can permission="member.deactivate" capabilities={capabilities}>
              {
                // Hidden for your own row, because the use-case refuses it: a button whose
                // only outcome is a CONFLICT is a button that should not be there.
                row.userId === user?.id ? null : (
                  <Button
                    variant="secondary"
                    disabled={deactivate.isPending || reactivate.isPending}
                    onClick={() =>
                      row.deactivated
                        ? reactivate.mutate({ userId: row.userId })
                        : deactivate.mutate({ userId: row.userId })
                    }
                  >
                    {row.deactivated
                      ? t("member.action.reactivate")
                      : t("member.action.deactivate")}
                  </Button>
                )
              }
            </Can>
            <Can permission="member.remove" capabilities={capabilities}>
              {row.userId === user?.id ? null : (
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => setRemoving(row)}
                >
                  {t("member.remove")}
                </Button>
              )}
            </Can>
          </>
        ),
      },
    ],
    [
      t,
      capabilities,
      user,
      deactivate,
      reactivate,
      onOpenAccess,
      roles,
      changing,
      changeRole,
      remove,
    ],
  );

  // The last-owner and self refusals get their own sentence: the catalog's generic
  // conflict copy says "someone else changed this first", which is wrong about both.
  const refusal = describe(
    deactivate.error ?? reactivate.error ?? changeRole.error ?? remove.error,
  );
  const reason = refusal?.envelope.context.reason;
  const refusalCopy =
    refusal?.envelope.code === "CONFLICT"
      ? t(
          reason === "self"
            ? "member.error.self"
            : reason === "lastPlatformAdmin"
              ? "member.error.lastPlatformAdmin"
              : "member.error.lastOwner",
        )
      : refusal?.message;

  if (members.isPending) return <DataTable.Skeleton rows={3} columns={4} />;
  // A failed list rendered as "no members yet", which is the one answer a members page
  // must not give when it does not know.
  if (members.isError) return <Callout tone="danger">{describe(members.error)?.message}</Callout>;
  if (rows.length === 0) return <EmptyState title={t("member.empty")} />;

  return (
    <>
      {refusal ? <Callout tone="danger">{refusalCopy}</Callout> : null}
      <DataTable columns={columns} rows={rows} caption={t("member.title")} />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("member.remove")}
        description={removing ? t("member.remove.confirm", { name: removing.name }) : undefined}
        confirmLabel={t("member.remove")}
        cancelLabel={t("member.action.cancel")}
        onConfirm={() => {
          if (removing) remove.mutate({ userId: removing.userId });
          setRemoving(null);
        }}
      />
      {inspecting ? (
        <section>
          <h3>{t("member.inspect.title", { name: inspecting.name })}</h3>
          {
            // The resolved set for *that* member, which only the server can answer —
            // the viewer's own comes off the session with no round trip.
          }
          <EffectivePermissionsInspector userId={inspecting.userId} />
          <Button variant="secondary" onClick={() => setInspecting(null)}>
            {t("member.inspect.close")}
          </Button>
        </section>
      ) : null}
    </>
  );
}
