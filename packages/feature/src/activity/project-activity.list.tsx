import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type ActivityDto,
  ActivityEntity,
  ActivityQueries,
  Avatar,
  Button,
  Callout,
  DateFormat,
  EmptyState,
  type ProjectId,
  useApiClient,
  useAppInfiniteQuery,
  useMemo,
} from "../import.js";

// The one payload field worth a line under the action: what it was done to.
const subjectOf = (row: ActivityDto): string | null => {
  for (const key of ["targetKey", "name", "fullName", "branch"] as const) {
    const value = row.payload[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
};

// One project's timeline: scans, settings, access and comments, newest first.
export function ProjectActivityList({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useMessages("activity");
  const describe = useErrorMessage();
  const client = useApiClient();
  const pages = useAppInfiniteQuery(ActivityQueries.project(client, projectId));
  const rows: readonly ActivityDto[] = useMemo(
    () => (pages.data?.pages ?? []).flatMap((page) => page.items),
    [pages.data],
  );

  if (pages.isPending) return <p className="m-0 text-sm text-fg-muted">…</p>;
  if (pages.isError) return <Callout tone="danger">{describe(pages.error)?.message}</Callout>;
  if (rows.length === 0) return <EmptyState title={t("activity.empty")} />;

  return (
    <div className="flex flex-col gap-4">
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((row) => {
          const actor = row.actorName ?? t("activity.formerMember");
          const subject = subjectOf(row);
          return (
            <li key={row.id} className="flex gap-3 border-b border-border py-3 last:border-0">
              <Avatar name={actor} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm">
                  <span className="font-semibold">{actor}</span> · {ActivityEntity.from(row).label}
                </p>
                {subject ? (
                  <p className="m-0 truncate font-mono text-xs text-fg-muted">{subject}</p>
                ) : null}
              </div>
              <time
                className="shrink-0 text-xs text-fg-muted"
                dateTime={row.occurredAt.toISOString()}
              >
                {DateFormat.dateTime(row.occurredAt)}
              </time>
            </li>
          );
        })}
      </ol>
      {pages.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {t("activity.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
