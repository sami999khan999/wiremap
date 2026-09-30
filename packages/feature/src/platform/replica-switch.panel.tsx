import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  PlatformMutations,
  PlatformQueries,
  StatusBadge,
  useApiClient,
  useAppQuery,
} from "../import.js";

// Rendered only when a standby exists. With none the status table already says "Not
// configured", and a switch over nothing is a setting nothing reads — `25.2`.
export function ReplicaSwitchPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const status = useAppQuery(PlatformQueries.status(client));
  const toggle = PlatformMutations.useToggleReplicaReads(client);

  const replica = status.data?.replica ?? null;
  if (!replica) return null;

  return (
    <section>
      <h2>{t("platform.replica.title")}</h2>
      <StatusBadge tone={replica.readsEnabled ? "success" : "neutral"}>
        {replica.readsEnabled ? t("platform.replica.on") : t("platform.replica.off")}
      </StatusBadge>
      <p>{t("platform.replica.detail")}</p>

      <Button
        variant="secondary"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ enabled: !replica.readsEnabled })}
      >
        {replica.readsEnabled ? t("platform.replica.disable") : t("platform.replica.enable")}
      </Button>

      {toggle.isError ? <Callout tone="danger">{describe(toggle.error)?.message}</Callout> : null}
    </section>
  );
}
