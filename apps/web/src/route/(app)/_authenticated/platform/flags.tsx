import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  FlagList,
  PLATFORM_ROUTE_PERMISSION,
  PlatformQueries,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Read, not manage: seeing which flags exist is how an operator finds out what is rolling
// out. The switches render only for `platform.flag.manage`.
export const Route = createFileRoute("/(app)/_authenticated/platform/flags")({
  beforeLoad: RouteGuard.requirePermission(PLATFORM_ROUTE_PERMISSION.flags),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(PlatformQueries.flags(context.api)),
    ]),
  component: PlatformFlags,
});

function PlatformFlags() {
  const { t } = useMessages("platform");

  return (
    <main>
      <h1>{t("platform.flags.title")}</h1>
      <FlagList />
    </main>
  );
}
