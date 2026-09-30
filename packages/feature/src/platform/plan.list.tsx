import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  type PlanDto,
  PlatformMutations,
  PlatformQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";
import { PlanForm } from "./plan.form.js";

interface PlanRow extends PlanDto {
  readonly id: string;
}

// Every plan, with how many orgs are on it and which one new signups get. A plan in use,
// a built-in plan and the default cannot be deleted; the server refuses each anyway.
export function PlanList() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const plans = useAppQuery(PlatformQueries.plans(client));
  const remove = PlatformMutations.useDeletePlan(client);
  const makeDefault = PlatformMutations.useUpdateDefaultPlan(client);
  // An affordance, not the gate: every write asserts `platform.entitlement.manage`.
  const canManage = useCapabilities().can("platform.entitlement.manage");

  // `null` is the new-plan form; a plan is that plan's form; `undefined` is no form.
  const [editing, setEditing] = useState<PlanDto | null | undefined>(undefined);

  const defaultKey = plans.data?.defaultPlanKey;
  const rows = useMemo<readonly PlanRow[]>(
    () => (plans.data?.items ?? []).map((plan) => ({ ...plan, id: plan.key })),
    [plans.data],
  );

  const columns = useMemo<readonly TableColumn<PlanRow>[]>(
    () => [
      {
        key: "plan",
        header: t("platform.plans.column.plan"),
        cell: (row) => (
          <>
            {row.name} <code>{row.key}</code>
            {row.key === defaultKey ? (
              <StatusBadge tone="accent">{t("platform.plans.default")}</StatusBadge>
            ) : null}
            {row.isSystem ? (
              <StatusBadge tone="neutral">{t("platform.plans.system")}</StatusBadge>
            ) : null}
          </>
        ),
      },
      {
        key: "permissions",
        header: t("platform.plans.column.permissions"),
        cell: (row) =>
          row.isUnlimited ? t("platform.plans.every") : String(row.permissions.length),
      },
      {
        key: "organizations",
        header: t("platform.plans.column.organizations"),
        cell: (row) => String(row.organizations),
      },
      {
        key: "actions",
        header: "",
        cell: (row) =>
          canManage ? (
            <>
              {row.isSystem ? null : (
                <Button variant="secondary" onClick={() => setEditing(row)}>
                  {t("platform.plans.edit")}
                </Button>
              )}
              {row.key === defaultKey ? null : (
                <Button
                  variant="secondary"
                  disabled={makeDefault.isPending}
                  onClick={() => makeDefault.mutate({ key: row.key })}
                >
                  {t("platform.plans.makeDefault")}
                </Button>
              )}
              {row.isSystem || row.organizations > 0 || row.key === defaultKey ? null : (
                <Button
                  variant="secondary"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ key: row.key })}
                >
                  {t("platform.plans.delete")}
                </Button>
              )}
            </>
          ) : null,
      },
    ],
    [t, defaultKey, canManage, remove, makeDefault],
  );

  const error = remove.error ?? makeDefault.error ?? plans.error;

  return (
    <section>
      <h2>{t("platform.plans.title")}</h2>
      {plans.isPending ? (
        <DataTable.Skeleton rows={2} columns={4} />
      ) : (
        <DataTable columns={columns} rows={rows} caption={t("platform.plans.title")} />
      )}
      {canManage && editing === undefined ? (
        <Button variant="secondary" onClick={() => setEditing(null)}>
          {t("platform.plans.new")}
        </Button>
      ) : null}
      {editing === undefined ? null : (
        <PlanForm
          key={editing?.key ?? "new"}
          {...(editing ? { plan: editing } : {})}
          onDone={() => setEditing(undefined)}
        />
      )}
      {error ? <Callout tone="danger">{describe(error)?.message}</Callout> : null}
    </section>
  );
}
