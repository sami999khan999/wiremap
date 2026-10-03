import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, useMessages } from "~/import.js";
import { AuthFrame } from "~/route/-auth-frame.js";

// Where `RouteGuard.requirePermission` sends a signed-in user who lacks the capability.
// The copy is a shell key, so this page renders correctly on any route that reached it.
export const Route = createFileRoute("/(shell)/forbidden")({ component: Forbidden });

function Forbidden() {
  const { t } = useMessages("common");

  return (
    <AuthFrame>
      <EmptyState icon="user" title={t("error.forbidden")} />
    </AuthFrame>
  );
}
