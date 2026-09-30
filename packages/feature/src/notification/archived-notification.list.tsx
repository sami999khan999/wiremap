import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  DateFormat,
  EmptyState,
  Field,
  type NotificationDto,
  NotificationQueries,
  type TableColumn,
  useApiClient,
  useAppInfiniteQuery,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

export interface ArchivedNotificationListProps {
  readonly limit?: number;
}

interface ArchivedRow extends NotificationDto {
  readonly id: NotificationDto["id"];
}

// The keyset envelope, structurally — restated for the reason `notification.list.tsx`
// gives: the contract's page type does not survive three packages of re-export.
interface ArchivedPage {
  readonly items: readonly NotificationDto[];
  readonly nextCursor: string | null;
}

// Straight out of cold storage, with no restore to wait for. The months offered are
// the ones that exist, because a date picker here would mostly return nothing.
export function ArchivedNotificationList({ limit = 25 }: ArchivedNotificationListProps) {
  const { t } = useMessages("notification");
  const describe = useErrorMessage();
  const client = useApiClient();

  const months = useAppQuery(NotificationQueries.archivedMonths(client));
  const [period, setPeriod] = useState("");

  // The first month only once one exists: defaulting to today would ask for an object
  // nobody has written and render an empty page as if it were an answer.
  const chosen = period || months.data?.[0]?.period || "";

  const page = useAppInfiniteQuery({
    ...NotificationQueries.archived(client, { period: chosen, limit }),
    enabled: chosen !== "",
  });

  const rows = useMemo<readonly ArchivedRow[]>(() => {
    const pages: readonly ArchivedPage[] = page.data?.pages ?? [];
    return pages.flatMap((one) => one.items.map((item) => ({ ...item, id: item.id })));
  }, [page.data]);

  const columns = useMemo<readonly TableColumn<ArchivedRow>[]>(
    () => [
      { key: "kind", header: t("notification.archived.column.kind"), cell: (row) => row.kind },
      {
        key: "created",
        header: t("notification.archived.column.created"),
        cell: (row) => DateFormat.day(row.createdAt),
      },
    ],
    [t],
  );

  if (months.isError) return <Callout tone="danger">{describe(months.error)?.message}</Callout>;
  if (months.isSuccess && months.data.length === 0) {
    return <EmptyState title={t("notification.archived.noMonths")} />;
  }

  return (
    <section>
      <h2>{t("notification.archived.title")}</h2>
      <p>{t("notification.archived.description")}</p>

      <Field label={t("notification.archived.month")} htmlFor="archived-month">
        <select
          id="archived-month"
          className="ui-input"
          value={chosen}
          onChange={(event) => setPeriod(event.target.value)}
        >
          {(months.data ?? []).map((month) => (
            <option key={month.period} value={month.period}>
              {month.period}
            </option>
          ))}
        </select>
      </Field>

      {page.isPending ? <DataTable.Skeleton rows={3} columns={2} /> : null}
      {page.isError ? <Callout tone="danger">{describe(page.error)?.message}</Callout> : null}
      {page.isSuccess && rows.length === 0 ? (
        <EmptyState title={t("notification.archived.empty")} />
      ) : null}
      {rows.length > 0 ? (
        <DataTable columns={columns} rows={rows} caption={t("notification.archived.title")} />
      ) : null}

      {page.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={page.isFetchingNextPage}
          onClick={() => void page.fetchNextPage()}
        >
          {t("notification.archived.more")}
        </Button>
      ) : null}
    </section>
  );
}
