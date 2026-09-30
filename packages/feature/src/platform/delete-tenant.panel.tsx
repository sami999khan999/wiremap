import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  type OrganizationId,
  PlatformMutations,
  useApiClient,
  useState,
} from "../import.js";

// Typing the slug is the confirmation, and the server compares it too: a check only
// the browser makes is one the API does not have.
export function DeleteTenantPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const remove = PlatformMutations.useDeleteTenant(client);

  const [organizationId, setOrganizationId] = useState("");
  const [slug, setSlug] = useState("");

  const ready = organizationId.trim().length === 36 && slug.trim().length > 0;

  return (
    <section>
      <h2>{t("platform.tenantDelete.title")}</h2>
      {
        // Said before the fields, not after the button: every month is archived first,
        // so this is recoverable for thirty days and then it is not.
        <Callout tone="warning">{t("platform.tenantDelete.warning")}</Callout>
      }

      <Field label={t("platform.storage.filter")} htmlFor="tenant-delete-org">
        <Input
          id="tenant-delete-org"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        />
      </Field>

      <Field
        label={t("platform.tenantDelete.slug")}
        htmlFor="tenant-delete-slug"
        hint={t("platform.tenantDelete.slug.hint")}
      >
        <Input
          id="tenant-delete-slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
      </Field>

      <Button
        variant="secondary"
        disabled={!ready || remove.isPending}
        onClick={() =>
          remove.mutate({
            organizationId: organizationId.trim() as OrganizationId,
            slug: slug.trim(),
          })
        }
      >
        {t("platform.tenantDelete.action")}
      </Button>

      {remove.isSuccess ? (
        <Callout tone="success">
          {t("platform.tenantDelete.queued", { jobId: remove.data.jobId })}
        </Callout>
      ) : null}
      {remove.isError ? <Callout tone="danger">{describe(remove.error)?.message}</Callout> : null}
    </section>
  );
}
