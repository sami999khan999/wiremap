import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DateFormat,
  EmptyState,
  OverrideMutations,
  OverrideQueries,
  StatusBadge,
  useApiClient,
  useAppQuery,
} from "../import.js";

export interface PermissionOverrideListProps {
  readonly userId: string;
}

// One person's live exceptions. A platform deny is shown with its lock and no clear button:
// the org admin can see it and cannot lift it, and the copy says who can.
export function PermissionOverrideList({ userId }: PermissionOverrideListProps) {
  const { t } = useMessages("role");
  const describe = useErrorMessage();
  const client = useApiClient();
  const overrides = useAppQuery(OverrideQueries.list(client, userId));
  const clear = OverrideMutations.useClear(client);
  // An affordance, not the gate: the use-case asserts `rbac.override.manage` either way.
  const canManage = useCapabilities().can("rbac.override.manage");

  const items = overrides.data?.items ?? [];

  if (overrides.isError)
    return <Callout tone="danger">{describe(overrides.error)?.message}</Callout>;
  if (!overrides.isPending && items.length === 0) {
    return <EmptyState title={t("role.override.empty")} />;
  }

  return (
    <section>
      <ul>
        {items.map((row) => (
          <li key={row.id} data-authority={row.authority}>
            <code>{row.permission}</code>{" "}
            <StatusBadge tone={row.effect === "grant" ? "success" : "danger"}>
              {row.effect === "grant" ? t("role.override.granted") : t("role.override.denied")}
            </StatusBadge>{" "}
            {row.expiresAt
              ? t("role.override.until", { date: DateFormat.day(row.expiresAt) })
              : null}{" "}
            {row.reason ? <small>{row.reason}</small> : null}{" "}
            {row.authority === "platform" ? (
              <StatusBadge tone="neutral">{t("role.override.platform")}</StatusBadge>
            ) : canManage ? (
              <Button
                variant="secondary"
                disabled={clear.isPending}
                onClick={() => clear.mutate({ overrideId: row.id })}
              >
                {t("role.override.clear")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {clear.isError ? <Callout tone="danger">{describe(clear.error)?.message}</Callout> : null}
    </section>
  );
}
