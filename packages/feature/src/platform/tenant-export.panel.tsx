import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  type OrganizationId,
  PlatformMutations,
  PlatformQueries,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

// Every byte the customer owns, as one object per table plus a manifest. The links are
// presigned and short-lived, so the list is read fresh rather than cached.
export function TenantExportPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const start = PlatformMutations.useExportTenant(client);

  const [typed, setTyped] = useState("");
  const organizationId =
    typed.trim().length === 36 ? (typed.trim() as OrganizationId) : ("" as OrganizationId);

  const exports = useAppQuery({
    ...PlatformQueries.exports(client, organizationId),
    enabled: organizationId !== "",
  });

  return (
    <section>
      <h2>{t("platform.tenantExport.title")}</h2>
      <p>{t("platform.tenantExport.description")}</p>

      <Field label={t("platform.storage.filter")} htmlFor="tenant-export-org">
        <Input
          id="tenant-export-org"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>

      <Button
        disabled={organizationId === "" || start.isPending}
        onClick={() => start.mutate({ organizationId })}
      >
        {t("platform.tenantExport.action")}
      </Button>

      {start.isSuccess ? (
        <Callout tone="success">
          {t("platform.tenantExport.queued", { jobId: start.data.jobId })}
        </Callout>
      ) : null}
      {start.isError ? <Callout tone="danger">{describe(start.error)?.message}</Callout> : null}

      {exports.isSuccess && exports.data.length === 0 ? (
        <p>{t("platform.tenantExport.empty")}</p>
      ) : null}
      {exports.isSuccess && exports.data.length > 0 ? (
        <ul>
          {exports.data.map((object) => (
            <li key={object.key}>
              {
                // A plain anchor: the URL is presigned and points at the bucket, so
                // routing it through this app would be a second copy of every byte.
                <a href={object.url}>{object.key}</a>
              }
            </li>
          ))}
        </ul>
      ) : null}
      {exports.isError ? <Callout tone="danger">{describe(exports.error)?.message}</Callout> : null}

      <p>{t("platform.tenantExport.expiry")}</p>
    </section>
  );
}
