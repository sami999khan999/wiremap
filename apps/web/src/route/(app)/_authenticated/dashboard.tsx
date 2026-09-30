import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CapabilitySet,
  type ClientNamespace,
  DashboardZone,
  prefetchDashboard,
  useMessages,
  useSession,
} from "~/import.js";

// `nav` for the heading and the nav card, `widget` for every card's title.
const MESSAGES = ["nav", "widget"] as const satisfies readonly ClientNamespace[];

// Behind the session guard its layout already applies. The cards are the registry's, and a
// card the viewer cannot see is neither prefetched here nor mounted below.
export const Route = createFileRoute("/(app)/_authenticated/dashboard")({
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    const [, nav] = await Promise.all([context.messages.ensure(MESSAGES), context.content.nav()]);
    await prefetchDashboard(
      context.queryClient,
      context.api,
      CapabilitySet.from(context.capabilities),
      context.flags,
    );
    return { nav };
  },
  component: Dashboard,
});

function Dashboard() {
  const { t } = useMessages("nav");
  const shell = useMessages("common");
  const { nav } = Route.useLoaderData();
  const { user } = useSession();

  // The session already carries every membership with its role, so naming the current one
  // costs no query.
  const active = user?.organizations.find((entry) => entry.id === user.activeOrganizationId);

  return (
    <>
      <h1>{t("nav.home.title", { organization: active?.name ?? shell.t("state.empty") })}</h1>
      {active ? <p>{t("nav.home.role", { role: active.roleName })}</p> : null}
      <DashboardZone
        nav={nav}
        renderLink={(route, label, icon) => (
          <Link key={route} to={route}>
            {icon}
            {label}
          </Link>
        )}
      />
    </>
  );
}
