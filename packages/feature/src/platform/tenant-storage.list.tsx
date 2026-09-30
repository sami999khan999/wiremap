import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  ByteFormat,
  Callout,
  DataTable,
  DateFormat,
  EmptyState,
  Field,
  Input,
  type OrganizationId,
  PlatformQueries,
  type TableColumn,
  type TenantStorageMonthDto,
  type TenantStorageRowDto,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

export interface TenantStorageListProps {
  readonly limit?: number;
}

interface StorageRow extends TenantStorageRowDto {
  readonly id: string;
}

interface MonthRow extends TenantStorageMonthDto {
  readonly id: string;
}

// Cold storage only: a partition holds one tenant's rows, but Postgres reports size
// per table, so hot bytes are on the retention screen instead.
export function TenantStorageList({ limit = 25 }: TenantStorageListProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();

  const [filter, setFilter] = useState("");
  // Only a complete id narrows the read: a half-typed uuid is not a prefix search,
  // and sending one would be a query per keystroke that matches nothing.
  const organizationId =
    filter.trim().length === 36 ? (filter.trim() as OrganizationId) : undefined;
  const storage = useAppQuery(
    PlatformQueries.storage(client, {
      limit,
      offset: 0,
      ...(organizationId && { organizationId }),
    }),
  );

  const rows = useMemo<readonly StorageRow[]>(() => {
    const items: readonly TenantStorageRowDto[] = storage.data?.items ?? [];
    return items.map((row) => ({ ...row, id: `${row.organizationId}:${row.tableName}` }));
  }, [storage.data]);

  const months = useMemo<readonly MonthRow[]>(() => {
    const items: readonly TenantStorageMonthDto[] = storage.data?.months ?? [];
    return items.map((row) => ({ ...row, id: `${row.tableName}:${row.period}` }));
  }, [storage.data]);

  const columns = useMemo<readonly TableColumn<StorageRow>[]>(
    () => [
      {
        key: "organization",
        header: t("platform.storage.column.organization"),
        // The id when the name is gone: the archive outlives a deleted tenant by
        // thirty days, and those rows are the ones worth finding.
        cell: (row) => row.organizationName ?? <code>{row.organizationId}</code>,
      },
      { key: "table", header: t("platform.storage.column.table"), cell: (row) => row.tableName },
      {
        key: "bytes",
        header: t("platform.storage.column.bytes"),
        cell: (row) => ByteFormat.size(row.bytes),
      },
      {
        key: "rows",
        header: t("platform.storage.column.rows"),
        cell: (row) => String(row.rows),
      },
      {
        key: "months",
        header: t("platform.storage.column.months"),
        cell: (row) => String(row.months),
      },
    ],
    [t],
  );

  const monthColumns = useMemo<readonly TableColumn<MonthRow>[]>(
    () => [
      { key: "table", header: t("platform.storage.column.table"), cell: (row) => row.tableName },
      { key: "period", header: t("platform.storage.column.period"), cell: (row) => row.period },
      {
        key: "bytes",
        header: t("platform.storage.column.bytes"),
        cell: (row) => ByteFormat.size(row.bytes),
      },
      { key: "rows", header: t("platform.storage.column.rows"), cell: (row) => String(row.rows) },
      {
        key: "actions",
        header: t("platform.storage.column.actionCounts"),
        // Empty for a table with no `action` column, which is most of them — an empty
        // cell rather than `{}`, which reads as a bug.
        cell: (row) =>
          Object.entries(row.actionCounts)
            .map(([action, count]) => `${action} ${count}`)
            .join(", "),
      },
      {
        key: "projected",
        header: t("platform.storage.column.projected"),
        // Null means ClickHouse never received this tenant-month. A gap is recorded
        // rather than blocking the drop, so the screen is where it becomes visible.
        cell: (row) =>
          row.projectedAt ? DateFormat.day(row.projectedAt) : t("platform.storage.notProjected"),
      },
    ],
    [t],
  );

  return (
    <section>
      <h2>{t("platform.storage.title")}</h2>
      <p>{t("platform.storage.description")}</p>

      <Field label={t("platform.storage.filter")} htmlFor="tenant-storage-filter">
        <Input
          id="tenant-storage-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </Field>

      {storage.isPending ? <DataTable.Skeleton rows={3} columns={5} /> : null}
      {storage.isError ? <Callout tone="danger">{describe(storage.error)?.message}</Callout> : null}
      {storage.isSuccess && rows.length === 0 ? (
        <EmptyState title={t("platform.storage.empty")} />
      ) : null}
      {storage.isSuccess && rows.length > 0 ? (
        <DataTable columns={columns} rows={rows} caption={t("platform.storage.title")} />
      ) : null}

      {months.length > 0 ? (
        <DataTable
          columns={monthColumns}
          rows={months}
          caption={t("platform.storage.months.title")}
        />
      ) : null}
    </section>
  );
}
