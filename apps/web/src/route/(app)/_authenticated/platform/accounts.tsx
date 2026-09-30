import { createFileRoute } from "@tanstack/react-router";
import { AccountPanel, type ClientNamespace, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Read, not manage: support looks an account up far more often than it locks one. The
// suspend and deny controls render only for `platform.account.manage`.
export const Route = createFileRoute("/(app)/_authenticated/platform/accounts")({
  beforeLoad: RouteGuard.requirePermission("platform.account.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: PlatformAccounts,
});

function PlatformAccounts() {
  const { t } = useMessages("platform");

  return (
    <main>
      <h1>{t("platform.accounts.title")}</h1>
      <p>{t("platform.accounts.description")}</p>
      <AccountPanel />
    </main>
  );
}
