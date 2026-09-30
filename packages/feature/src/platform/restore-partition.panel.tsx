import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  PlatformMutations,
  type RetentionEntryDto,
  useApiClient,
  useState,
} from "../import.js";

export interface RestorePartitionPanelProps {
  // The tables a month can be restored for, which is the ones with a month level. The
  // caller already has them from the retention list rather than fetching a second time.
  readonly tables: readonly RetentionEntryDto[];
}

// Reading a month back out of cold storage. **An archive nobody has restored is a
// deletion with extra steps**, and this is where that stops being only a spec.
export function RestorePartitionPanel({ tables }: RestorePartitionPanelProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const restore = PlatformMutations.useRestorePartition(client);

  const [tableName, setTableName] = useState(tables[0]?.tableName ?? "");
  const [period, setPeriod] = useState("");

  // `YYYY-MM` from a month input, and the contract wants the first of it: a mid-month
  // date names no partition, so the day is added here rather than asked for.
  const firstOf = (month: string): string => `${month}-01`;
  const ready = tableName !== "" && /^\d{4}-\d{2}$/.test(period);

  return (
    <section>
      <h2>{t("platform.restore.title")}</h2>
      <p>{t("platform.restore.description")}</p>

      <Field label={t("platform.restore.table")} htmlFor="restore-table">
        {
          // A `<select>` rather than free text, and the options are the tables the
          // server would accept: a name typed by hand is a validation error at best.
        }
        <select
          id="restore-table"
          className="ui-input"
          value={tableName}
          onChange={(event) => setTableName(event.target.value)}
        >
          {tables.map((table) => (
            <option key={table.tableName} value={table.tableName}>
              {table.tableName}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("platform.restore.period")} htmlFor="restore-period">
        <Input
          id="restore-period"
          type="month"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        />
      </Field>

      <Button
        disabled={!ready || restore.isPending}
        onClick={() => restore.mutate({ tableName, period: firstOf(period) })}
      >
        {t("platform.restore.submit")}
      </Button>

      {
        // The job id and which of the two outcomes applies. A restore outside the hot
        // window lands in a scratch table and stays there, which the copy says.
        restore.isSuccess ? (
          <Callout tone="success">
            {t("platform.restore.queued", {
              jobId: restore.data.jobId,
              objects: restore.data.objects,
            })}
          </Callout>
        ) : null
      }

      {restore.isError ? <Callout tone="danger">{describe(restore.error)?.message}</Callout> : null}
    </section>
  );
}
