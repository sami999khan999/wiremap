import { useCapabilities, useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  AlertDialog,
  Button,
  Callout,
  Can,
  Field,
  Input,
  type MemberDto,
  MemberQueries,
  OrganizationProfileMutations,
  OrganizationQueries,
  Select,
  useApiClient,
  useAppQuery,
  useEffect,
  useState,
} from "../import.js";

export interface OrganizationSettingsPanelProps {
  // After a rename or a transfer the session snapshot is stale: the top bar reads the
  // name and the caller's role off it. The call site refreshes it.
  readonly onChanged: () => void;
  // After a delete is queued the session points at a tenant that is going away.
  readonly onDeleted: () => void;
}

// The organization's own settings: its name, handing it over, and deleting it. Each
// section is behind its own key, so an admin sees the first and not the other two.
export function OrganizationSettingsPanel({
  onChanged,
  onDeleted,
}: OrganizationSettingsPanelProps) {
  const { t } = useMessages("organization");
  const { t: common } = useMessages("common");
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const { user } = useSession();
  const organization = useAppQuery(OrganizationQueries.get(client));
  const members = useAppQuery(MemberQueries.list(client, { limit: 100, offset: 0 }));
  const update = OrganizationProfileMutations.useUpdate(client);
  const transfer = OrganizationProfileMutations.useTransferOwnership(client);
  const remove = OrganizationProfileMutations.useRemove(client);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [successor, setSuccessor] = useState<string | null>(null);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [typedSlug, setTypedSlug] = useState("");

  useEffect(() => {
    if (organization.data) setName(organization.data.name);
  }, [organization.data]);

  if (organization.isPending) return null;
  if (organization.isError)
    return <Callout tone="danger">{describe(organization.error)?.message}</Callout>;
  const current = organization.data;

  const candidates: readonly MemberDto[] = (members.data?.items ?? []).filter(
    (member) => member.userId !== user?.id && !member.deactivated && !member.suspended,
  );
  const successorName = candidates.find((member) => member.userId === successor)?.name ?? "";
  const error = describe(update.error ?? transfer.error ?? remove.error);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold">{t("organization.settings.profile")}</h2>
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(
              { name },
              {
                onSuccess: () => {
                  setSaved(true);
                  onChanged();
                },
              },
            );
          }}
        >
          <Field label={t("organization.settings.name")} htmlFor="organization-name">
            <Input
              value={name}
              maxLength={80}
              disabled={!capabilities.can("organization.profile.update")}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <Field
            label={t("organization.settings.slug")}
            htmlFor="organization-slug"
            hint={t("organization.settings.slugHint")}
          >
            <Input value={current.slug} readOnly className="font-mono" />
          </Field>
          <Can permission="organization.profile.update" capabilities={capabilities}>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={update.isPending || name.trim() === "" || name === current.name}
              >
                {t("organization.settings.save")}
              </Button>
              {saved ? (
                <span className="text-sm text-fg-muted">{t("organization.settings.saved")}</span>
              ) : null}
            </div>
          </Can>
        </form>
      </section>

      <Can permission="organization.ownership.transfer" capabilities={capabilities}>
        <section className="flex max-w-md flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold">{t("organization.transfer.title")}</h2>
          <p className="m-0 text-sm text-fg-muted">{t("organization.transfer.intro")}</p>
          {candidates.length === 0 ? (
            <Callout tone="info">{t("organization.transfer.none")}</Callout>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("organization.transfer.member")} htmlFor="transfer-member">
                <Select
                  label={t("organization.transfer.member")}
                  value={successor}
                  onValueChange={setSuccessor}
                  options={candidates.map((member) => ({
                    value: member.userId,
                    label: member.name || member.email,
                  }))}
                />
              </Field>
              <Button
                variant="secondary"
                disabled={!successor || transfer.isPending}
                onClick={() => setConfirmingTransfer(true)}
              >
                {t("organization.transfer.submit")}
              </Button>
            </div>
          )}
          <AlertDialog
            open={confirmingTransfer}
            onOpenChange={setConfirmingTransfer}
            tone="primary"
            title={t("organization.transfer.title")}
            description={t("organization.transfer.confirm", { name: successorName })}
            confirmLabel={t("organization.transfer.submit")}
            cancelLabel={common("action.cancel")}
            onConfirm={() => {
              setConfirmingTransfer(false);
              if (successor)
                transfer.mutate(
                  { userId: successor as MemberDto["userId"] },
                  { onSuccess: onChanged },
                );
            }}
          />
        </section>
      </Can>

      <Can permission="organization.delete" capabilities={capabilities}>
        <section className="flex max-w-md flex-col gap-3 rounded-lg border border-danger p-4">
          <h2 className="m-0 text-lg font-semibold text-danger">
            {t("organization.delete.title")}
          </h2>
          <p className="m-0 text-sm text-fg-muted">{t("organization.delete.intro")}</p>
          <Field
            label={t("organization.delete.confirmLabel", { slug: current.slug })}
            htmlFor="delete-slug"
          >
            <Input
              value={typedSlug}
              onChange={(event) => setTypedSlug(event.target.value)}
              className="font-mono"
            />
          </Field>
          <Button
            variant="danger"
            disabled={typedSlug.trim() !== current.slug || remove.isPending}
            onClick={() =>
              remove.mutate({ confirmSlug: typedSlug.trim() }, { onSuccess: onDeleted })
            }
          >
            {t("organization.delete.submit")}
          </Button>
        </section>
      </Can>

      {error ? <Callout tone="danger">{error.message}</Callout> : null}
    </div>
  );
}
