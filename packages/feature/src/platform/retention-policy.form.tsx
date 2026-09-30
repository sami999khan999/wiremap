import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  type ColdModeDto,
  DataTable,
  Field,
  Input,
  PlatformMutations,
  PlatformQueries,
  type RetentionEntryDto,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useCallback,
  useState,
} from "../import.js";
import { RetentionPreviewNotice } from "./retention-preview.notice.js";

// Two buttons rather than a `<select>`: `ui` has no select primitive, and two options
// is a choice a person can see rather than open — `MODES` in the notification form.
const MODES = ["archive", "drop"] as const;

// What the inputs hold while they are being edited. A row is only sent on save, so a
// half-typed "1" in a months field must not become a policy.
interface Draft {
  readonly hotMonths: string;
  readonly coldMonths: string;
  readonly coldMode: ColdModeDto;
}

const draftOf = (row: RetentionEntryDto): Draft => ({
  hotMonths: row.hotMonths === null ? "" : String(row.hotMonths),
  coldMonths: row.coldMonths === null ? "" : String(row.coldMonths),
  coldMode: row.coldMode,
});

// Blank is "never expires" for cold months and "leave the default" for hot ones, which
// is why this returns null rather than zero for an empty string.
const monthsOf = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

export function RetentionPolicyForm() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const retention = useAppQuery(PlatformQueries.retention(client));
  const update = PlatformMutations.useUpdateRetention(client);

  // Keyed by table, and only for the rows somebody has touched: an uncontrolled input
  // per row would lose its value on every refetch.
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  // **The save is disabled until a preview for the current value has loaded.** Lowering
  // a retention number schedules a mass drop, and this is the last thing before it.
  const [previewed, setPreviewed] = useState<Readonly<Record<string, boolean>>>({});

  const markPreviewed = useCallback(
    (tableName: string) => (ready: boolean) =>
      setPreviewed((current) =>
        current[tableName] === ready ? current : { ...current, [tableName]: ready },
      ),
    [],
  );

  if (retention.isPending) return <DataTable.Skeleton columns={4} rows={4} />;
  if (retention.isError) {
    return <Callout tone="danger">{describe(retention.error)?.message}</Callout>;
  }

  const draftFor = (row: RetentionEntryDto): Draft => drafts[row.tableName] ?? draftOf(row);
  const edit = (row: RetentionEntryDto, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [row.tableName]: { ...draftFor(row), ...patch },
    }));
  };

  const lifecycle = retention.data.lifecycle;
  const drifted = lifecycle.expected.join("|") !== lifecycle.applied.join("|");

  return (
    <div>
      <p>{t("platform.retention.description")}</p>

      {
        // The bucket beside the rows. A screen showing only the rows would say "saved"
        // about a call that failed after the commit.
        drifted ? (
          <Callout tone="warning">
            {t("platform.retention.drift", { actual: lifecycle.applied.join(", ") || "—" })}
          </Callout>
        ) : null
      }

      {retention.data.postgres.map((row: RetentionEntryDto) => {
        const draft = draftFor(row);

        return (
          <fieldset key={row.tableName}>
            <legend>
              <code>{row.tableName}</code>{" "}
              {row.isDefault ? (
                <StatusBadge tone="neutral">{t("platform.retention.default")}</StatusBadge>
              ) : null}
            </legend>

            {row.neverDropped ? <p>{t("platform.retention.neverDropped")}</p> : null}

            <Field label={t("platform.retention.hotMonths")} htmlFor={`hot-${row.tableName}`}>
              <Input
                id={`hot-${row.tableName}`}
                type="number"
                min={1}
                value={draft.hotMonths}
                onChange={(event) => edit(row, { hotMonths: event.target.value })}
              />
            </Field>

            <Field
              label={t("platform.retention.coldMonths")}
              htmlFor={`cold-${row.tableName}`}
              hint={t("platform.retention.coldMonths.hint")}
            >
              <Input
                id={`cold-${row.tableName}`}
                type="number"
                min={0}
                value={draft.coldMonths}
                onChange={(event) => edit(row, { coldMonths: event.target.value })}
              />
            </Field>

            <div>
              {MODES.map((mode) => (
                <Button
                  key={mode}
                  variant={draft.coldMode === mode ? "primary" : "secondary"}
                  aria-pressed={draft.coldMode === mode}
                  onClick={() => edit(row, { coldMode: mode })}
                >
                  {t(`platform.retention.mode.${mode}` as never)}
                </Button>
              ))}
            </div>

            {
              // The one setting on this page that destroys data, said before the save
              // rather than after it.
              draft.coldMode === "drop" ? (
                <Callout tone="danger">{t("platform.retention.mode.warning")}</Callout>
              ) : null
            }

            <RetentionPreviewNotice
              tableName={row.tableName}
              hotMonths={draft.hotMonths}
              onReady={markPreviewed(row.tableName)}
            />

            <Button
              disabled={
                update.isPending ||
                monthsOf(draft.hotMonths) === null ||
                previewed[row.tableName] !== true
              }
              onClick={() =>
                update.mutate({
                  store: "postgres",
                  tableName: row.tableName,
                  hotMonths: monthsOf(draft.hotMonths) ?? 1,
                  coldMonths: monthsOf(draft.coldMonths),
                  coldMode: draft.coldMode,
                })
              }
            >
              {t("platform.retention.save")}
            </Button>
          </fieldset>
        );
      })}

      {
        // Absent on a deployment running no analytics store, which is the third state:
        // not configured, rather than on or off.
        retention.data.clickhouse ? (
          <fieldset>
            <legend>{t("platform.retention.clickhouse")}</legend>
            <Field label={t("platform.retention.clickhouse.months")} htmlFor="clickhouse-months">
              <Input
                id="clickhouse-months"
                type="number"
                min={1}
                value={
                  drafts.activity_events?.hotMonths ?? String(retention.data.clickhouse.months)
                }
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    activity_events: {
                      hotMonths: event.target.value,
                      coldMonths: "",
                      coldMode: "archive",
                    },
                  }))
                }
              />
            </Field>
            <Button
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  store: "clickhouse",
                  tableName: "activity_events",
                  hotMonths:
                    monthsOf(drafts.activity_events?.hotMonths ?? "") ??
                    retention.data.clickhouse?.months ??
                    60,
                  coldMonths: null,
                  coldMode: "archive",
                })
              }
            >
              {t("platform.retention.save")}
            </Button>
          </fieldset>
        ) : null
      }

      {update.isError ? <Callout tone="danger">{describe(update.error)?.message}</Callout> : null}
    </div>
  );
}
