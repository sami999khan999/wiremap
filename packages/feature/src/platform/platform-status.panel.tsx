import { useMessages } from "../i18n/index.js";
import {
  Callout,
  DataTable,
  PlatformQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
} from "../import.js";

// A dependency's three states. `null` is the one that matters: absent is neither
// passing nor failing, and reporting it as "Down" is an outage nobody has.
type Reading = boolean | null;

interface DependencyRow {
  readonly id: string;
  readonly label: string;
  readonly state: Reading;
}

const TONE: Readonly<Record<"up" | "down" | "absent", "success" | "danger" | "neutral">> = {
  up: "success",
  down: "danger",
  absent: "neutral",
};

const readingOf = (state: Reading): "up" | "down" | "absent" => {
  if (state === null) return "absent";
  return state ? "up" : "down";
};

// The proof page. It shows nothing a tenant screen could not; what it proves is that a
// platform-scoped key resolves through a role in the tier and gates a real surface.
export function PlatformStatusPanel() {
  const { t } = useMessages("platform");
  const client = useApiClient();
  const status = useAppQuery(PlatformQueries.status(client));

  const rows = useMemo<readonly DependencyRow[]>(() => {
    const health = status.data?.health;
    if (!health) return [];
    const replica = status.data?.replica ?? null;

    return [
      { id: "database", label: t("platform.health.database"), state: health.database },
      { id: "cache", label: t("platform.health.cache"), state: health.cache },
      { id: "queue", label: t("platform.health.queue"), state: health.queue },
      { id: "analytics", label: t("platform.health.analytics"), state: health.analytics },
      { id: "realtime", label: t("platform.health.realtime"), state: health.realtime },
      // Not in `healthy`: a standby that falls behind slows the batch reads, it
      // takes nothing down, so it reports beside the dependencies rather than among them.
      { id: "replica", label: t("platform.health.replica"), state: replica?.healthy ?? null },
    ];
  }, [status.data, t]);

  const columns = useMemo<readonly TableColumn<DependencyRow>[]>(
    () => [
      { key: "label", header: t("platform.health.title"), cell: (row) => row.label },
      {
        key: "state",
        header: t("platform.status.title"),
        cell: (row) => {
          const reading = readingOf(row.state);
          return <StatusBadge tone={TONE[reading]}>{t(`platform.state.${reading}`)}</StatusBadge>;
        },
      },
    ],
    [t],
  );

  if (status.isPending) return <DataTable.Skeleton rows={5} columns={2} />;
  // Never "everything is fine" when the read failed: a status page that guesses is
  // worse than one that says it does not know.
  if (status.isError) return <Callout tone="danger">{t("platform.health.degraded")}</Callout>;

  const organization = status.data.organization;
  const lagSeconds = status.data.replica?.lagSeconds ?? null;

  return (
    <>
      <p>
        {t("platform.organization")}:{" "}
        {t("platform.organization.detail", {
          name: organization.name,
          slug: organization.slug,
        })}
      </p>
      <StatusBadge tone={status.data.health.healthy ? "success" : "danger"}>
        {t(status.data.health.healthy ? "platform.health.healthy" : "platform.health.degraded")}
      </StatusBadge>
      <DataTable columns={columns} rows={rows} caption={t("platform.health.title")} />
      {lagSeconds === null ? null : (
        <p>{t("platform.replica.lag", { seconds: lagSeconds.toFixed(1) })}</p>
      )}
    </>
  );
}
