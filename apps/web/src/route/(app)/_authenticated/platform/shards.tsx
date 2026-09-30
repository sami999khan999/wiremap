import { createFileRoute } from "@tanstack/react-router";
import { type ClientNamespace, ROUTES, ShardMapPanel, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// No loader prefetch: the node list is one row per physical node and the tenants under
// it are whichever node the first click expands, which this route cannot know.
export const Route = createFileRoute("/(app)/_authenticated/platform/shards")({
  beforeLoad: RouteGuard.requirePermission("platform.shards.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: PlatformShards,
});

function PlatformShards() {
  const { t } = useMessages("platform");

  return (
    <main>
      <h1>{t("platform.shards.title")}</h1>
      <ShardMapPanel storageHref={ROUTES.platform.storage} />
    </main>
  );
}
