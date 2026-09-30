import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type ApiKeyDto,
  ApiKeyEntity,
  ApiKeyMutations,
  ApiKeyQueries,
  Button,
  Callout,
  Can,
  CodeList,
  DataTable,
  DateFormat,
  EmptyState,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
} from "../import.js";

export interface ApiKeyListProps {
  // Paged rather than unbounded: `Pagination.query` caps `limit` at 100 in the schema.
  readonly limit?: number;
}

interface ApiKeyRow extends ApiKeyDto {
  readonly id: ApiKeyDto["id"];
}

export function ApiKeyList({ limit = 25 }: ApiKeyListProps) {
  const { t } = useMessages("apikey");
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const keys = useAppQuery(ApiKeyQueries.list(client, { limit, offset: 0 }));
  const revoke = ApiKeyMutations.useRevoke(client);

  // One instant for the whole render pass: read per row, two of them disagree about
  // whether a key expiring this second is expired.
  const now = useMemo(() => new Date(), [keys.data]);

  const rows = useMemo<readonly ApiKeyRow[]>(() => {
    // Annotated rather than inferred: the client's procedure types are reconstructed
    // through two packages, and a break anywhere degrades to `any` silently.
    const items: readonly ApiKeyDto[] = keys.data?.items ?? [];
    return items.map((key) => ({ ...key, id: key.id }));
  }, [keys.data]);

  const columns = useMemo<readonly TableColumn<ApiKeyRow>[]>(
    () => [
      { key: "name", header: t("apikey.column.name"), cell: (row) => row.name },
      {
        key: "prefix",
        header: t("apikey.column.prefix"),
        // The prefix and an ellipsis, never a full token: the rest does not exist.
        cell: (row) => <code>{`${row.prefix}…`}</code>,
      },
      {
        key: "scopes",
        header: t("apikey.column.scopes"),
        cell: (row) => <CodeList values={row.scopes} label={t("apikey.column.scopes")} />,
      },
      {
        key: "lastUsed",
        header: t("apikey.column.lastUsed"),
        cell: (row) =>
          row.lastUsedAt ? DateFormat.day(row.lastUsedAt) : t("apikey.lastUsed.never"),
      },
      {
        key: "status",
        header: t("apikey.column.status"),
        cell: (row) => {
          const key = ApiKeyEntity.from(row);
          if (key.revoked)
            return <StatusBadge tone="danger">{t("apikey.status.revoked")}</StatusBadge>;
          if (key.expired(now))
            return <StatusBadge tone="warning">{t("apikey.status.expired")}</StatusBadge>;
          return <StatusBadge tone="success">{t("apikey.status.active")}</StatusBadge>;
        },
      },
      {
        key: "actions",
        header: t("apikey.column.actions"),
        cell: (row) => (
          <Can permission="apikey.manage" capabilities={capabilities}>
            {
              // Hidden once revoked, because the use-case is idempotent and a button
              // whose only outcome is "nothing changed" should not be there.
              row.revokedAt ? null : (
                <Button
                  variant="secondary"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (confirm(t("apikey.revoke.confirm", { name: row.name }))) {
                      revoke.mutate({ apiKeyId: row.id });
                    }
                  }}
                >
                  {t("apikey.action.revoke")}
                </Button>
              )
            }
          </Can>
        ),
      },
    ],
    [t, capabilities, revoke, now],
  );

  if (keys.isPending) return <DataTable.Skeleton rows={3} columns={6} />;
  // A failed list rendered as "no keys yet" is the one answer this page must not give
  // when it does not know: it reads as "nothing is authenticating against us".
  if (keys.isError) return <Callout tone="danger">{describe(keys.error)?.message}</Callout>;
  if (rows.length === 0) return <EmptyState title={t("apikey.empty")} />;

  return (
    <>
      {revoke.error ? <Callout tone="danger">{describe(revoke.error)?.message}</Callout> : null}
      <DataTable columns={columns} rows={rows} caption={t("apikey.title")} />
    </>
  );
}
