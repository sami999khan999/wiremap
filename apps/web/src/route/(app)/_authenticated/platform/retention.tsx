import { createFileRoute } from "@tanstack/react-router";
import {
  Can,
  type ClientNamespace,
  PlatformQueries,
  RestorePartitionPanel,
  RetentionPolicyForm,
  TenantRetentionForm,
  useApiClient,
  useAppQuery,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Read on the route, manage around the editor: seeing how long data is kept is an
// operational question, and shortening it destroys rows on the next run.
export const Route = createFileRoute("/(app)/_authenticated/platform/retention")({
  beforeLoad: RouteGuard.requirePermission("platform.retention.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(PlatformQueries.retention(context.api)),
    ]),
  component: PlatformRetention,
});

function PlatformRetention() {
  const { t } = useMessages("platform");
  const capabilities = useCapabilities();

  return (
    <main>
      <h1>{t("platform.retention.title")}</h1>
      <Can permission="platform.retention.manage" capabilities={capabilities}>
        <RetentionPolicyForm />
      </Can>
      {
        // Beside the editor rather than on its own page: restoring a month is the thing
        // an operator reaches for right after reading how long months are kept.
        <Can permission="platform.retention.manage" capabilities={capabilities}>
          <RestoreSection />
        </Can>
      }
    </main>
  );
}

// The table list the panel offers comes from the same query the form reads, so the
// loader has already filled it and this adds no round trip.
function RestoreSection() {
  const client = useApiClient();
  const retention = useAppQuery(PlatformQueries.retention(client));

  if (!retention.isSuccess) return null;

  // Only the tables an override can name: the use-case refuses one on a table the
  // calendar never retires, so offering it would be a form whose save is an error.
  const overridable = retention.data.postgres.filter((table) => !table.neverDropped);

  return (
    <>
      <RestorePartitionPanel tables={retention.data.postgres} />
      <TenantRetentionForm tables={overridable} />
    </>
  );
}
