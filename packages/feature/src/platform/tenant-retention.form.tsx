import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  type OrganizationId,
  PlatformMutations,
  type RetentionEntryDto,
  useApiClient,
  useCallback,
  useState,
} from "../import.js";
import { RetentionPreviewNotice } from "./retention-preview.notice.js";

export interface TenantRetentionFormProps {
  // Tenant-partitioned **and** already retired by the calendar: the use-case refuses
  // the rest, so offering them would be a form whose save is a validation error.
  readonly tables: readonly RetentionEntryDto[];
}

// The tenant is typed rather than picked: the shard map is where a list of tenants
// belongs, and a picker here would be a second one to keep in step.
export function TenantRetentionForm({ tables }: TenantRetentionFormProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const update = PlatformMutations.useUpdateTenantRetention(client);

  const [organizationId, setOrganizationId] = useState("");
  const [tableName, setTableName] = useState(tables[0]?.tableName ?? "");
  const [hotMonths, setHotMonths] = useState("");
  const [coldMonths, setColdMonths] = useState("");
  // The same contract the table-wide form keeps: **the save waits for a preview of the
  // value on screen**, so a number that retires a tenant's months is never one click away.
  const [previewed, setPreviewed] = useState(false);

  const months = (value: string): number | null => {
    const parsed = Number(value.trim());
    return value.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };

  const onReady = useCallback((value: boolean) => setPreviewed(value), []);

  const ready =
    organizationId.length > 0 &&
    tableName !== "" &&
    (months(hotMonths) ?? 0) >= 1 &&
    // Only once a tenant has been typed: a preview keyed on an empty id is a request
    // the server would refuse, and the notice would report it as a failure.
    previewed;

  if (tables.length === 0) return null;

  return (
    <section>
      <h2>{t("platform.tenantRetention.title")}</h2>
      <p>{t("platform.tenantRetention.description")}</p>

      <Field label={t("platform.tenantRetention.organization")} htmlFor="tenant-retention-org">
        <Input
          id="tenant-retention-org"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        />
      </Field>

      <Field label={t("platform.restore.table")} htmlFor="tenant-retention-table">
        <select
          id="tenant-retention-table"
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

      <Field label={t("platform.retention.hotMonths")} htmlFor="tenant-retention-hot">
        <Input
          id="tenant-retention-hot"
          type="number"
          min={1}
          value={hotMonths}
          onChange={(event) => setHotMonths(event.target.value)}
        />
      </Field>

      <Field
        label={t("platform.retention.coldMonths")}
        htmlFor="tenant-retention-cold"
        hint={t("platform.retention.coldMonths.hint")}
      >
        <Input
          id="tenant-retention-cold"
          type="number"
          min={0}
          value={coldMonths}
          onChange={(event) => setColdMonths(event.target.value)}
        />
      </Field>

      {organizationId.length > 0 ? (
        <RetentionPreviewNotice
          tableName={tableName}
          hotMonths={hotMonths}
          organizationId={organizationId}
          onReady={onReady}
        />
      ) : (
        <p>{t("platform.tenantRetention.organizationFirst")}</p>
      )}

      <Button
        disabled={!ready || update.isPending}
        onClick={() =>
          update.mutate({
            organizationId: organizationId as OrganizationId,
            tableName,
            hotMonths: months(hotMonths) ?? 1,
            coldMonths: months(coldMonths),
          })
        }
      >
        {t("platform.retention.save")}
      </Button>

      {
        // Said plainly: the bucket cannot express a shorter window than the table's, so
        // a tenant's cold months are enforced by the nightly sweep rather than by S3.
        <p>{t("platform.tenantRetention.coldNote")}</p>
      }

      {update.isSuccess ? (
        <Callout tone="success">{t("platform.tenantRetention.saved")}</Callout>
      ) : null}
      {update.isError ? <Callout tone="danger">{describe(update.error)?.message}</Callout> : null}
    </section>
  );
}
