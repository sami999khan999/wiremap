import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type BadgeTone,
  Button,
  Callout,
  Can,
  DataTable,
  DateFormat,
  EmptyState,
  type ProjectId,
  type ScanDto,
  ScanMutations,
  ScanQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
} from "../import.js";

const TONE: Readonly<Record<ScanDto["state"], BadgeTone>> = {
  queued: "neutral",
  running: "accent",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
};

const duration = (scan: ScanDto) => {
  if (!scan.startedAt || !scan.finishedAt) return "";
  const seconds = Math.max(
    0,
    Math.round((scan.finishedAt.getTime() - scan.startedAt.getTime()) / 1000),
  );
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

// A project's scans, newest first, polling while one is queued or running. "Scan now" is
// shown to whoever may run one on this project, and says plainly why it cannot.
export function ScanHistory({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useMessages("scan");
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const scans = useAppQuery(ScanQueries.list(client, projectId, { limit: 50, offset: 0 }));
  const run = ScanMutations.useRun(client);
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const rows: readonly ScanDto[] = scans.data?.items ?? [];
  const busy = rows.some((scan) => scan.state === "queued" || scan.state === "running");

  const columns: readonly TableColumn<ScanDto>[] = [
    {
      key: "state",
      header: t("scan.state"),
      cell: (row) => (
        <StatusBadge tone={TONE[row.state]}>{t(`scan.state.${row.state}`)}</StatusBadge>
      ),
    },
    { key: "trigger", header: t("scan.trigger"), cell: (row) => t(`scan.trigger.${row.trigger}`) },
    { key: "branch", header: t("scan.branch"), cell: (row) => row.branch ?? "" },
    {
      key: "commit",
      header: t("scan.commit"),
      cell: (row) => <span className="font-mono text-xs">{row.commitSha?.slice(0, 7) ?? ""}</span>,
    },
    { key: "queued", header: t("scan.started"), cell: (row) => DateFormat.dateTime(row.queuedAt) },
    { key: "duration", header: t("scan.duration"), cell: (row) => duration(row) },
    {
      key: "result",
      header: t("scan.result"),
      cell: (row) =>
        row.error ? (
          <span className="text-sm text-danger">{row.error}</span>
        ) : row.counts ? (
          t("scan.result.summary", { files: row.counts.files, routes: row.counts.routes })
        ) : (
          ""
        ),
    },
  ];

  const refusal = describe(run.error);
  // The two refusals a person can act on carry their own copy; anything else, the generic.
  const rule = refusal?.envelope.fields?.[0]?.rule;

  return (
    <div className="flex flex-col gap-4">
      <Can permission="project.scan.run" goalId={projectId} capabilities={capabilities}>
        <div>
          <Button
            disabled={busy || run.isPending}
            onClick={() => run.mutate({ projectId, branch: null })}
          >
            {busy ? t("scan.running") : t("scan.run")}
          </Button>
        </div>
      </Can>
      {refusal ? (
        <Callout tone="warning">
          {rule === "noRunner"
            ? t("scan.noRunner")
            : rule === "noRepositories"
              ? t("scan.noRepositories")
              : refusal.message}
        </Callout>
      ) : null}
      {scans.isPending ? (
        <DataTable.Skeleton rows={3} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="graph"
          title={t("scan.empty")}
          description={t("scan.empty.description")}
        />
      ) : (
        <div className="overflow-x-auto">
          <DataTable columns={columns} rows={rows} caption={t("scan.title")} />
        </div>
      )}
    </div>
  );
}
