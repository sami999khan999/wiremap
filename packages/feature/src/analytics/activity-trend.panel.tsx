import { useMessages } from "../i18n/index.js";
import {
  type ActivityPointDto,
  AnalyticsQueries,
  Button,
  Callout,
  DataTable,
  EmptyState,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

type Period = 30 | 90;

// `to` is exclusive — tomorrow's midnight — so the day a reader would call the end is the
// one before it. Printing `to` itself would name a day the window does not contain.
const lastDayOf = (to: string): string =>
  new Date(Date.parse(`${to}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);

interface TotalRow {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

// Largest first, then by label, so two renders of the same numbers are the same table.
const byCount = (rows: Map<string, number>): readonly TotalRow[] =>
  [...rows.entries()]
    .map(([label, count]) => ({ id: label, label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

// The first dashboard — `23.14`. Two tables rather than a chart: a table is what a chart
// would need beside it for a screen reader anyway, and `ui` has no chart primitive yet.
export function ActivityTrendPanel() {
  const { t } = useMessages("analytics");
  const client = useApiClient();
  const [days, setDays] = useState<Period>(30);
  const activity = useAppQuery(AnalyticsQueries.activity(client, days));

  const { perDay, perAction, total } = useMemo(() => {
    const points: readonly ActivityPointDto[] = activity.data?.points ?? [];
    const dayTotals = new Map<string, number>();
    const actionTotals = new Map<string, number>();
    for (const point of points) {
      dayTotals.set(point.day, (dayTotals.get(point.day) ?? 0) + point.count);
      actionTotals.set(point.action, (actionTotals.get(point.action) ?? 0) + point.count);
    }
    return {
      // Newest first: the question on opening the page is "what happened lately".
      perDay: [...dayTotals.entries()]
        .map(([day, count]) => ({ id: day, label: day, count }))
        .sort((left, right) => right.label.localeCompare(left.label)),
      perAction: byCount(actionTotals),
      total: points.reduce((sum, point) => sum + point.count, 0),
    };
  }, [activity.data]);

  const dayColumns = useMemo<readonly TableColumn<TotalRow>[]>(
    () => [
      { key: "day", header: t("analytics.column.day"), cell: (row) => row.label },
      { key: "count", header: t("analytics.column.count"), cell: (row) => String(row.count) },
    ],
    [t],
  );

  const actionColumns = useMemo<readonly TableColumn<TotalRow>[]>(
    () => [
      {
        key: "action",
        header: t("analytics.column.action"),
        cell: (row) => <code>{row.label}</code>,
      },
      { key: "count", header: t("analytics.column.count"), cell: (row) => String(row.count) },
    ],
    [t],
  );

  const periods: readonly Period[] = [30, 90];

  return (
    <section>
      <fieldset>
        <legend>{t("analytics.period.label")}</legend>
        {periods.map((period) => (
          <Button
            key={period}
            variant={period === days ? "primary" : "secondary"}
            aria-pressed={period === days}
            onClick={() => setDays(period)}
          >
            {t(`analytics.period.${period}`)}
          </Button>
        ))}
      </fieldset>

      {activity.isPending ? <DataTable.Skeleton rows={5} columns={2} /> : null}
      {
        // Never an empty chart when the read failed: that would say the tenant did nothing.
        activity.isError ? <Callout tone="danger">{t("analytics.failed")}</Callout> : null
      }

      {activity.isSuccess && !activity.data.configured ? (
        <Callout tone="warning">{t("analytics.notConfigured")}</Callout>
      ) : null}

      {activity.isSuccess && activity.data.configured ? (
        <>
          <p>
            {t("analytics.range", { from: activity.data.from, to: lastDayOf(activity.data.to) })}.{" "}
            {t("analytics.total", { count: total })}
          </p>
          {total === 0 ? (
            <EmptyState title={t("analytics.empty")} />
          ) : (
            <>
              <h2>{t("analytics.byDay.title")}</h2>
              <DataTable columns={dayColumns} rows={perDay} caption={t("analytics.byDay.title")} />
              <h2>{t("analytics.byAction.title")}</h2>
              <DataTable
                columns={actionColumns}
                rows={perAction}
                caption={t("analytics.byAction.title")}
              />
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
