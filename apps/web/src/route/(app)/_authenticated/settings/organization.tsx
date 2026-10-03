import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { type ClientNamespace, OrganizationSettingsPanel, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";
import { refreshSession } from "~/route/-session.js";

const MESSAGES = ["organization"] as const satisfies readonly ClientNamespace[];

// Gated on the profile key, the one the module gate names: an owner and an admin reach it,
// and the transfer and delete sections inside are gated again on their own keys.
export const Route = createFileRoute("/(app)/_authenticated/settings/organization")({
  beforeLoad: RouteGuard.requirePermission("organization.profile.update"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: OrganizationSettings,
});

function OrganizationSettings() {
  const { t } = useMessages("organization");
  const { session, queryClient } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();

  // The top bar reads the name and the caller's role off the session snapshot.
  const refresh = (to: "/" | "/settings/organization") => () =>
    refreshSession({
      queryClient,
      session,
      invalidateRouter: () => router.invalidate(),
      go: () => void navigate({ to }),
    });

  return (
    <section className="flex flex-col gap-6">
      <h1 className="m-0 text-2xl font-semibold">{t("organization.settings.title")}</h1>
      <OrganizationSettingsPanel
        onChanged={refresh("/settings/organization")}
        onDeleted={refresh("/")}
      />
    </section>
  );
}
