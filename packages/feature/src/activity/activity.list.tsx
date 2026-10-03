import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type ActivityDto,
  ActivityEntity,
  ActivityQueries,
  Button,
  Callout,
  DataTable,
  DateFormat,
  EmptyState,
  Select,
  type TableColumn,
  useApiClient,
  useAppInfiniteQuery,
  useMemo,
  useState,
} from "../import.js";

const ALL = "__all";

// The tenant's audit trail, newest first, filtered by action. Keyset-paged: "Load older"
// follows the cursor and never re-reads a row.
export function ActivityList() {
  const { t } = useMessages("activity");
  const describe = useErrorMessage();
  const client = useApiClient();
  const [action, setAction] = useState<string>(ALL);
  const filters = action === ALL ? {} : { action };
  const pages = useAppInfiniteQuery(ActivityQueries.list(client, filters));
  const actions = useMemo(() => ActivityEntity.actions(), []);

  const rows: readonly ActivityDto[] = useMemo(
    () => (pages.data?.pages ?? []).flatMap((page) => page.items),
    [pages.data],
  );

  const columns: readonly TableColumn<ActivityDto>[] = [
    { key: "when", header: t("activity.when"), cell: (row) => DateFormat.dateTime(row.occurredAt) },
    {
      key: "who",
      header: t("activity.who"),
      cell: (row) => row.actorName ?? t("activity.formerMember"),
    },
    { key: "what", header: t("activity.what"), cell: (row) => ActivityEntity.from(row).label },
    {
      key: "details",
      header: t("activity.details"),
      cell: (row) => (
        <span className="font-mono text-xs text-fg-muted">
          {Object.entries(row.payload)
            .map(
              ([key, value]) =>
                `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
            )
            .join(" ")}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <Select
          label={t("activity.filter.action")}
          value={action}
          onValueChange={setAction}
          options={[
            { value: ALL, label: t("activity.filter.allActions") },
            ...actions.map((entry) => ({ value: entry.key, label: entry.label })),
          ]}
        />
      </div>
      {pages.isPending ? (
        <DataTable.Skeleton rows={5} columns={4} />
      ) : pages.isError ? (
        <Callout tone="danger">{describe(pages.error)?.message}</Callout>
      ) : rows.length === 0 ? (
        <EmptyState title={t("activity.empty")} />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} caption={t("activity.title")} />
          {pages.hasNextPage ? (
            <Button
              variant="secondary"
              disabled={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            >
              {t("activity.loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
