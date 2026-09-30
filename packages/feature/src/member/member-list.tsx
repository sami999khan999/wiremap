import { useCapabilities, useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Can,
  DataTable,
  DateFormat,
  EmptyState,
  type MemberDto,
  MemberMutations,
  MemberQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";
import { EffectivePermissionsInspector } from "../rbac/index.js";

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
  // One row at a time: the inspector issues a query, and opening every row would issue
  // one per member on a page of twenty-five.
  const [inspecting, setInspecting] = useState<MemberDto | null>(null);

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
          </>
        ),
      },
    ],
    [t, capabilities, user, deactivate, reactivate, onOpenAccess],
  );

  // The last-owner and self refusals get their own sentence: the catalog's generic
  // conflict copy says "someone else changed this first", which is wrong about both.
  const refusal = describe(deactivate.error ?? reactivate.error);
  const refusalCopy =
    refusal?.envelope.code === "CONFLICT"
      ? t(
          refusal.envelope.context.reason === "self"
            ? "member.error.self"
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
