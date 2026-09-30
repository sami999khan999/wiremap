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

export interface ProjectionSwitchPanelProps {
  // The audit table's hot window, for the deadline sentence. From the retention screen's
  // own numbers, so the two cannot disagree about how long a pause is recoverable.
  readonly auditMonths: number | null;
}

// Three states, not two. "Not configured" is neither on nor off, and rendering it as
// off would invite someone to turn on a store that does not exist.
export function ProjectionSwitchPanel({ auditMonths }: ProjectionSwitchPanelProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const policy = useAppQuery(PlatformQueries.policy(client));
  const toggle = PlatformMutations.useToggleProjection(client);

  if (!policy.isSuccess) return null;

  const { projectionEnabled, analyticsConfigured } = policy.data;

  return (
    <section>
      <h2>{t("platform.switch.title")}</h2>

      {!analyticsConfigured ? (
        <>
          <StatusBadge tone="warning">{t("platform.switch.notConfigured")}</StatusBadge>
          <p>{t("platform.switch.notConfigured.detail")}</p>
        </>
      ) : (
        <>
          <StatusBadge tone={projectionEnabled ? "success" : "warning"}>
            {projectionEnabled ? t("platform.switch.on") : t("platform.switch.off")}
          </StatusBadge>

          <Button
            variant="secondary"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate({ enabled: !projectionEnabled })}
          >
            {projectionEnabled ? t("platform.switch.pause") : t("platform.switch.resume")}
          </Button>
        </>
      )}

      {
        // Shown while it is on, because that is when someone is deciding, and while it
        // is off, because that is when the clock is running.
        analyticsConfigured ? (
          <Callout tone={projectionEnabled ? "warning" : "danger"}>
            {auditMonths === null
              ? t("platform.switch.deadline.unbounded")
              : t("platform.switch.deadline", { months: auditMonths })}
          </Callout>
        ) : null
      }

      {toggle.isError ? <Callout tone="danger">{describe(toggle.error)?.message}</Callout> : null}
    </section>
  );
}
