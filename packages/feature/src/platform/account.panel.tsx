import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type AccountDenyDto,
  type AccountDto,
  type AccountMembershipDto,
  Button,
  Callout,
  CORE_MODULE,
  DataTable,
  DateFormat,
  EmptyState,
  Field,
  Input,
  inputClassName,
  type PermissionKey,
  PermissionRegistry,
  PlatformMutations,
  PlatformQueries,
  StatusBadge,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

interface MembershipRow extends AccountMembershipDto {
  readonly id: string;
}

// Every key but `core`, which everyone holds. Tenant and platform keys both: the server
// refuses a platform key outside the tier, and says so, rather than the list guessing.
const DENIABLE: readonly PermissionKey[] = Object.freeze(
  PermissionRegistry.instance
    .all()
    .filter((key) => PermissionRegistry.instance.meta(key)?.module !== CORE_MODULE),
);

// One account across every tenant: where it belongs, whether the platform has locked it,
// and what the platform has taken from it. Reading needs the read key; every control, manage.
export function AccountPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const canManage = useCapabilities().can("platform.account.manage");

  const [term, setTerm] = useState("");
  // What was submitted, not every keystroke: a lookup per character is a query per letter.
  const [email, setEmail] = useState("");
  const account = useAppQuery(PlatformQueries.account(client, email));
  const suspend = PlatformMutations.useSuspendAccount(client);
  const reinstate = PlatformMutations.useReinstateAccount(client);
  const deny = PlatformMutations.useDenyAccountPermission(client);
  const clear = PlatformMutations.useClearAccountDeny(client);

  const [reason, setReason] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [permission, setPermission] = useState<string>(DENIABLE[0] ?? "");
  const [denyReason, setDenyReason] = useState("");

  // Annotated, as `MemberList` is: the procedure type is rebuilt through two packages, and
  // its branded ids degrade to an error type in this one.
  const data: AccountDto | undefined = account.data;
  const memberships = useMemo<readonly MembershipRow[]>(
    () => (data?.memberships ?? []).map((row) => ({ ...row, id: row.organizationId })),
    [data],
  );
  const nameOf = useMemo(() => {
    const names = new Map(memberships.map((row) => [row.organizationId, row.name]));
    return (id: string) => names.get(id as MembershipRow["organizationId"]) ?? id;
  }, [memberships]);

  const membershipColumns = useMemo<readonly TableColumn<MembershipRow>[]>(
    () => [
      {
        key: "organization",
        header: t("platform.account.column.organization"),
        cell: (row) => (
          <>
            {row.name} <code>{row.slug}</code>{" "}
            {row.deactivated ? (
              <StatusBadge tone="warning">{t("platform.account.deactivated")}</StatusBadge>
            ) : null}
          </>
        ),
      },
      { key: "role", header: t("platform.account.column.role"), cell: (row) => row.roleName },
    ],
    [t],
  );

  const denyColumns = useMemo<readonly TableColumn<AccountDenyDto>[]>(
    () => [
      {
        key: "permission",
        header: t("platform.account.column.permission"),
        cell: (row) => <code>{row.permission}</code>,
      },
      {
        key: "organization",
        header: t("platform.account.column.organization"),
        cell: (row) => nameOf(row.organizationId),
      },
      {
        key: "reason",
        header: t("platform.account.column.reason"),
        cell: (row) => row.reason ?? "",
      },
      {
        key: "clear",
        header: "",
        cell: (row) =>
          canManage ? (
            <Button
              variant="secondary"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate({ organizationId: row.organizationId, overrideId: row.id })
              }
            >
              {t("platform.account.clear")}
            </Button>
          ) : null,
      },
    ],
    [t, canManage, clear, nameOf],
  );

  const error = suspend.error ?? reinstate.error ?? deny.error ?? clear.error ?? account.error;
  const target = organizationId || (memberships[0]?.organizationId ?? "");

  return (
    <section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setEmail(term.trim());
        }}
      >
        <Field label={t("platform.account.lookup")} htmlFor="account-email">
          <Input
            id="account-email"
            type="email"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </Field>
      </form>

      {data ? (
        <>
          <h2>
            {data.name} <code>{data.email}</code>{" "}
            {data.suspendedAt ? (
              <StatusBadge tone="danger">
                {t("platform.account.suspendedOn", { date: DateFormat.day(data.suspendedAt) })}
              </StatusBadge>
            ) : (
              <StatusBadge tone="success">{t("platform.account.active")}</StatusBadge>
            )}
          </h2>

          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const input = { userId: data.userId, reason };
                const done = { onSuccess: () => setReason("") };
                if (data.suspendedAt) reinstate.mutate(input, done);
                else suspend.mutate(input, done);
              }}
            >
              <Field label={t("platform.account.reason")} htmlFor="account-reason">
                <Input
                  id="account-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant={data.suspendedAt ? "secondary" : "danger"}
                disabled={suspend.isPending || reinstate.isPending || reason.trim() === ""}
              >
                {data.suspendedAt ? t("platform.account.reinstate") : t("platform.account.suspend")}
              </Button>
            </form>
          ) : null}

          <h3>{t("platform.account.memberships")}</h3>
          {memberships.length === 0 ? (
            <EmptyState title={t("platform.account.memberships.none")} />
          ) : (
            <DataTable
              columns={membershipColumns}
              rows={memberships}
              caption={t("platform.account.memberships")}
            />
          )}

          <h3>{t("platform.account.denies")}</h3>
          {data.denies.length === 0 ? (
            <EmptyState title={t("platform.account.denies.none")} />
          ) : (
            <DataTable
              columns={denyColumns}
              rows={data.denies}
              caption={t("platform.account.denies")}
            />
          )}

          {canManage && memberships.length > 0 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                deny.mutate(
                  {
                    userId: data.userId,
                    organizationId: target as MembershipRow["organizationId"],
                    permission,
                    reason: denyReason,
                  },
                  { onSuccess: () => setDenyReason("") },
                );
              }}
            >
              <Field label={t("platform.account.deny.organization")} htmlFor="deny-organization">
                <select
                  id="deny-organization"
                  className={inputClassName()}
                  value={target}
                  onChange={(event) => setOrganizationId(event.target.value)}
                >
                  {memberships.map((row) => (
                    <option key={row.organizationId} value={row.organizationId}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("platform.account.column.permission")} htmlFor="deny-permission">
                <select
                  id="deny-permission"
                  className={inputClassName()}
                  value={permission}
                  onChange={(event) => setPermission(event.target.value)}
                >
                  {DENIABLE.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("platform.account.column.reason")} htmlFor="deny-reason">
                <Input
                  id="deny-reason"
                  value={denyReason}
                  onChange={(event) => setDenyReason(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={deny.isPending || denyReason.trim() === ""}>
                {t("platform.account.deny")}
              </Button>
              {deny.data ? (
                <p>
                  {t("platform.account.denied", { permissions: deny.data.permissions.join(", ") })}
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
