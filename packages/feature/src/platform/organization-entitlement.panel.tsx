import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type AdjustmentDto,
  Button,
  Callout,
  CORE_MODULE,
  DataTable,
  DateFormat,
  EmptyState,
  Field,
  Input,
  type PermissionKey,
  PermissionRegistry,
  PlatformMutations,
  PlatformQueries,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

interface AdjustmentRow extends AdjustmentDto {
  readonly id: string;
}

// The keys an adjustment can name: the same universe a plan is edited over.
const ADJUSTABLE: readonly PermissionKey[] = Object.freeze(
  PermissionRegistry.instance.all().filter((key) => {
    const meta = PermissionRegistry.instance.meta(key);
    return meta !== undefined && meta.module !== CORE_MODULE && meta.scope !== "platform";
  }),
);

// One org: its plan, its departures from it, and the effective result against the roles it
// actually has — "entitled to 47; their Accountant role holds 12 of them".
export function OrganizationEntitlementPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const canManage = useCapabilities().can("platform.entitlement.manage");

  const [term, setTerm] = useState("");
  // What was submitted, not every keystroke: a lookup per character is a query per letter.
  const [organization, setOrganization] = useState("");
  const entitlement = useAppQuery(PlatformQueries.entitlement(client, organization));
  const plans = useAppQuery(PlatformQueries.plans(client));
  const assign = PlatformMutations.useAssignPlan(client);
  const adjust = PlatformMutations.useAdjustEntitlement(client);
  const clear = PlatformMutations.useClearAdjustment(client);

  const [planKey, setPlanKey] = useState("");
  const [permission, setPermission] = useState<string>(ADJUSTABLE[0] ?? "");
  const [effect, setEffect] = useState<"add" | "remove">("add");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");

  const data = entitlement.data;
  const rows = useMemo<readonly AdjustmentRow[]>(
    () => (data?.adjustments ?? []).map((row) => ({ ...row, id: row.permission })),
    [data],
  );

  const columns = useMemo<readonly TableColumn<AdjustmentRow>[]>(
    () => [
      {
        key: "permission",
        header: t("platform.entitlement.column.permission"),
        cell: (row) => <code>{row.permission}</code>,
      },
      {
        key: "effect",
        header: t("platform.entitlement.column.effect"),
        cell: (row) =>
          row.effect === "add"
            ? t("platform.entitlement.effect.add")
            : t("platform.entitlement.effect.remove"),
      },
      { key: "reason", header: t("platform.entitlement.column.reason"), cell: (row) => row.reason },
      {
        key: "expires",
        header: t("platform.entitlement.column.expires"),
        cell: (row) =>
          row.expiresAt ? DateFormat.day(row.expiresAt) : t("platform.entitlement.never"),
      },
      {
        key: "clear",
        header: "",
        cell: (row) =>
          canManage ? (
            <Button
              variant="secondary"
              disabled={clear.isPending}
              onClick={() => clear.mutate({ organization, permission: row.permission })}
            >
              {t("platform.entitlement.clear")}
            </Button>
          ) : null,
      },
    ],
    [t, canManage, clear, organization],
  );

  const error = assign.error ?? adjust.error ?? clear.error ?? entitlement.error;

  return (
    <section>
      <h2>{t("platform.entitlement.title")}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setOrganization(term.trim());
        }}
      >
        <Field label={t("platform.entitlement.lookup")} htmlFor="entitlement-organization">
          <Input
            id="entitlement-organization"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </Field>
      </form>

      {data ? (
        <>
          <h3>
            {data.organization.name} <code>{data.organization.slug}</code>
          </h3>
          <p>{t("platform.entitlement.summary", { count: data.entitled.length })}</p>
          <ul>
            {data.roles.map((role) => (
              <li key={role.key}>
                {t("platform.entitlement.role", {
                  role: role.name,
                  entitled: role.entitled,
                  listed: role.listed,
                })}
              </li>
            ))}
          </ul>

          <Field label={t("platform.entitlement.plan")} htmlFor="entitlement-plan">
            <select
              id="entitlement-plan"
              className="ui-input"
              value={planKey || data.planKey}
              disabled={!canManage}
              onChange={(event) => setPlanKey(event.target.value)}
            >
              {(plans.data?.items ?? []).map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.name}
                </option>
              ))}
            </select>
          </Field>
          {canManage ? (
            <Button
              variant="secondary"
              disabled={assign.isPending || planKey === "" || planKey === data.planKey}
              onClick={() => assign.mutate({ organization, planKey })}
            >
              {t("platform.entitlement.assign")}
            </Button>
          ) : null}

          <h3>{t("platform.entitlement.adjustments")}</h3>
          {rows.length === 0 ? (
            <EmptyState title={t("platform.entitlement.adjustments.none")} />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              caption={t("platform.entitlement.adjustments")}
            />
          )}

          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                adjust.mutate(
                  {
                    organization,
                    permission,
                    effect,
                    reason,
                    expiresAt: expires === "" ? null : new Date(expires),
                  },
                  { onSuccess: () => setReason("") },
                );
              }}
            >
              <Field
                label={t("platform.entitlement.column.permission")}
                htmlFor="adjust-permission"
              >
                <select
                  id="adjust-permission"
                  className="ui-input"
                  value={permission}
                  onChange={(event) => setPermission(event.target.value)}
                >
                  {ADJUSTABLE.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("platform.entitlement.adjust.effect")} htmlFor="adjust-effect">
                <select
                  id="adjust-effect"
                  className="ui-input"
                  value={effect}
                  onChange={(event) =>
                    setEffect(event.target.value === "remove" ? "remove" : "add")
                  }
                >
                  <option value="add">{t("platform.entitlement.effect.add")}</option>
                  <option value="remove">{t("platform.entitlement.effect.remove")}</option>
                </select>
              </Field>
              <Field label={t("platform.entitlement.adjust.reason")} htmlFor="adjust-reason">
                <Input
                  id="adjust-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Field label={t("platform.entitlement.adjust.expires")} htmlFor="adjust-expires">
                <Input
                  id="adjust-expires"
                  type="datetime-local"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={adjust.isPending || reason.trim() === ""}>
                {t("platform.entitlement.adjust")}
              </Button>
              {adjust.data ? (
                <p>
                  {t("platform.entitlement.adjusted", {
                    permissions: adjust.data.permissions.join(", "),
                  })}
                </p>
              ) : null}
            </form>
          ) : null}
        </>
      ) : null}

      {error ? <Callout tone="danger">{describe(error)?.message}</Callout> : null}
    </section>
  );
}
