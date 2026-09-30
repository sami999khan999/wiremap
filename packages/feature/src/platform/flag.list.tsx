import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  Field,
  type FlagDto,
  Input,
  PlatformMutations,
  PlatformQueries,
  Select,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

interface FlagRow extends FlagDto {
  readonly id: string;
}

// Every flag, server-only ones included: metadata from code, switches from the database.
// See packages/permissions/docs/reference/flag-registry.md.
export function FlagList() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const flags = useAppQuery(PlatformQueries.flags(client));
  const update = PlatformMutations.useUpdateFlag(client);
  const target = PlatformMutations.useUpdateFlagTarget(client);
  // An affordance, not the gate: the use-case asserts `platform.flag.manage` either way.
  const canManage = useCapabilities().can("platform.flag.manage");

  const [flagKey, setFlagKey] = useState("");
  const [organization, setOrganization] = useState("");

  // UTC, like the build check that fails an expired flag, so the two agree on the day.
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo<readonly FlagRow[]>(
    () => (flags.data?.items ?? []).map((flag) => ({ ...flag, id: flag.key })),
    [flags.data],
  );
  const declared = rows.filter((row) => !row.orphaned);

  const columns = useMemo<readonly TableColumn<FlagRow>[]>(
    () => [
      {
        key: "flag",
        header: t("platform.flags.column.flag"),
        cell: (row) => (
          <>
            <code>{row.key}</code>
            {row.orphaned ? (
              <StatusBadge tone="warning">{t("platform.flags.orphaned")}</StatusBadge>
            ) : null}
            <p>{row.orphaned ? t("platform.flags.orphaned.detail") : row.description}</p>
          </>
        ),
      },
      { key: "owner", header: t("platform.flags.column.owner"), cell: (row) => row.owner ?? "" },
      {
        key: "expires",
        header: t("platform.flags.column.expires"),
        cell: (row) =>
          row.expiresOn === null ? (
            ""
          ) : (
            <>
              {row.expiresOn}
              {row.expiresOn < today ? (
                <StatusBadge tone="danger">{t("platform.flags.expired")}</StatusBadge>
              ) : null}
            </>
          ),
      },
      {
        key: "everyone",
        header: t("platform.flags.column.everyone"),
        cell: (row) => (
          <>
            <StatusBadge tone={row.isEnabled ? "success" : "neutral"}>
              {row.isEnabled ? t("platform.flags.on") : t("platform.flags.off")}
            </StatusBadge>
            {
              // An orphan can only be switched off: on would switch something no code reads.
              canManage && (!row.orphaned || row.isEnabled) ? (
                <Button
                  variant="secondary"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ key: row.key, enabled: !row.isEnabled })}
                >
                  {row.isEnabled ? t("platform.flags.disable") : t("platform.flags.enable")}
                </Button>
              ) : null
            }
          </>
        ),
      },
      {
        key: "organizations",
        header: t("platform.flags.column.organizations"),
        cell: (row) =>
          row.targets.length === 0 ? (
            t("platform.flags.organizations.none")
          ) : (
            <ul>
              {row.targets.map((entry) => (
                <li key={entry.organizationId}>
                  <code>{entry.slug}</code>
                  {canManage ? (
                    <Button
                      variant="secondary"
                      disabled={target.isPending}
                      onClick={() =>
                        target.mutate({
                          key: row.key,
                          organization: entry.organizationId,
                          enabled: false,
                        })
                      }
                    >
                      {t("platform.flags.organization.remove", { slug: entry.slug })}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ),
      },
    ],
    [t, today, canManage, update, target],
  );

  const error = update.error ?? target.error ?? flags.error;

  return (
    <section>
      <p>{t("platform.flags.description")}</p>

      {flags.isPending ? (
        <DataTable.Skeleton rows={2} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("platform.flags.empty")} />
      ) : (
        <DataTable columns={columns} rows={rows} caption={t("platform.flags.title")} />
      )}

      {canManage && declared.length > 0 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const key = flagKey || declared[0]?.key;
            if (!key || organization.trim() === "") return;
            target.mutate(
              { key, organization, enabled: true },
              { onSuccess: () => setOrganization("") },
            );
          }}
        >
          <Field label={t("platform.flags.column.flag")} htmlFor="flag-target-key">
            <Select
              id="flag-target-key"
              label={t("platform.flags.column.flag")}
              value={flagKey || declared[0]?.key || null}
              onValueChange={setFlagKey}
              options={declared.map((row) => ({ value: row.key, label: row.key }))}
            />
          </Field>
          <Field label={t("platform.flags.organization.label")} htmlFor="flag-target-organization">
            <Input
              id="flag-target-organization"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={target.isPending || organization.trim() === ""}>
            {t("platform.flags.organization.add")}
          </Button>
        </form>
      ) : null}

      {error ? <Callout tone="danger">{describe(error)?.message}</Callout> : null}
    </section>
  );
}
