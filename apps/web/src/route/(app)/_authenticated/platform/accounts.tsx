import { createFileRoute } from "@tanstack/react-router";
import {
  AccountPanel,
  Can,
  type ClientNamespace,
  DeleteTenantPanel,
  PLATFORM_ROUTE_PERMISSION,
  TenantExportPanel,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Read, not manage: support looks an account up far more often than it locks one. The
// suspend and deny controls render only for `platform.account.manage`.
export const Route = createFileRoute("/(app)/_authenticated/platform/accounts")({
  beforeLoad: RouteGuard.requirePermission(PLATFORM_ROUTE_PERMISSION.accounts),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: PlatformAccounts,
});

function PlatformAccounts() {
  const { t } = useMessages("platform");
  const capabilities = useCapabilities();

  return (
    <main>
      <h1>{t("platform.accounts.title")}</h1>
      <p>{t("platform.accounts.description")}</p>
      <AccountPanel />
      {
        // Here since lite dropped the storage page. One confirmation form that asks for
        // the slug to be typed back, in one place that can get it wrong.
        <Can permission="platform.tenant.manage" capabilities={capabilities}>
          <TenantExportPanel />
          <DeleteTenantPanel />
        </Can>
      }
    </main>
  );
}
