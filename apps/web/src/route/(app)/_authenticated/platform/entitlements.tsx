import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  OrganizationEntitlementPanel,
  PlanList,
  PlatformQueries,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Read, not manage: seeing what an org is entitled to is how support answers "why can't
// they". The editing controls render only for `platform.entitlement.manage`.
export const Route = createFileRoute("/(app)/_authenticated/platform/entitlements")({
  beforeLoad: RouteGuard.requirePermission("platform.entitlement.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(PlatformQueries.plans(context.api)),
    ]),
  component: PlatformEntitlements,
});

function PlatformEntitlements() {
  const { t } = useMessages("platform");

  return (
    <main>
      <h1>{t("platform.entitlements.title")}</h1>
      <p>{t("platform.entitlements.description")}</p>
      <PlanList />
      <OrganizationEntitlementPanel />
    </main>
  );
}
