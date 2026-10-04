import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  GithubAppPanel,
  Page,
  PLATFORM_ROUTE_PERMISSION,
  PlatformQueries,
  useMessages,
  z,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// `/api/github/manifest` sends the platform admin back here with the outcome.
const Search = z.object({ app: z.enum(["created", "failed"]).optional().catch(undefined) });

export const Route = createFileRoute("/(app)/_authenticated/platform/github")({
  validateSearch: Search,
  beforeLoad: RouteGuard.requirePermission(PLATFORM_ROUTE_PERMISSION.github),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(PlatformQueries.githubApp(context.api)),
    ]),
  component: PlatformGithub,
});

function PlatformGithub() {
  const { t } = useMessages("platform");
  const { app } = Route.useSearch();

  return (
    <Page>
      <h1>{t("platform.github.title")}</h1>
      <GithubAppPanel {...(app ? { result: app } : {})} />
    </Page>
  );
}
