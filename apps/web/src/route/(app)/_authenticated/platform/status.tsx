import { createFileRoute } from "@tanstack/react-router";
import {
  Can,
  type ClientNamespace,
  ModuleSwitchPanel,
  PLATFORM_ROUTE_PERMISSION,
  PlatformQueries,
  PlatformStatusPanel,
  ReplicaSwitchPanel,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Behind `platform.status.read` — the key the procedure is gated on and the use-case
// asserts. A tenant owner is redirected, which is the tier working. See doc 23.
export const Route = createFileRoute("/(app)/_authenticated/platform/status")({
  beforeLoad: RouteGuard.requirePermission(PLATFORM_ROUTE_PERMISSION.status),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(PlatformQueries.status(context.api)),
    ]),
  component: PlatformStatus,
});

function PlatformStatus() {
  const { t } = useMessages("platform");
  const capabilities = useCapabilities();

  return (
    <main>
      <h1>{t("platform.title")}</h1>
      <p>{t("platform.subtitle")}</p>
      <PlatformStatusPanel />
      <Can permission="platform.replica.manage" capabilities={capabilities}>
        <ReplicaSwitchPanel />
      </Can>
      <Can permission="platform.module.manage" capabilities={capabilities}>
        <ModuleSwitchPanel />
      </Can>
    </main>
  );
}
