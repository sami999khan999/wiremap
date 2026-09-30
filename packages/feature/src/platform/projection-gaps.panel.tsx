import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  PlatformMutations,
  PlatformQueries,
  useApiClient,
  useAppQuery,
} from "../import.js";

// Months the derived store never fully received, off the partial index on
// `(table_name, period) where projected_at is null`.
export function ProjectionGapsPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const gaps = useAppQuery(PlatformQueries.gaps(client));
  const reproject = PlatformMutations.useReprojectPartition(client);

  if (!gaps.isSuccess) return null;

  return (
    <section>
      <h2>{t("platform.gaps.title")}</h2>

      {gaps.data.length === 0 ? <p>{t("platform.gaps.none")}</p> : null}

      {gaps.data.map((gap) => (
        <div key={`${gap.tableName}:${gap.period}`}>
          <p>{t("platform.gaps.row", { period: gap.period, tenants: gap.tenants })}</p>
          <Button
            variant="secondary"
            disabled={reproject.isPending}
            onClick={() => reproject.mutate({ period: gap.period })}
          >
            {t("platform.gaps.reproject")}
          </Button>
        </div>
      ))}

      {
        // Said once, under the list: the reason a gap exists is on the
        // `analytics.projection.gap` log line and is not stored, so this cannot say it.
        gaps.data.length > 0 ? <p>{t("platform.gaps.reason")}</p> : null
      }

      {reproject.isSuccess ? (
        <Callout tone="success">
          {t("platform.gaps.queued", {
            jobId: reproject.data.jobId,
            objects: reproject.data.objects,
          })}
        </Callout>
      ) : null}
      {reproject.isError ? (
        <Callout tone="danger">{describe(reproject.error)?.message}</Callout>
      ) : null}
    </section>
  );
}
