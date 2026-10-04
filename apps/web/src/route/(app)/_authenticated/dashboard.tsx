import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Can,
  CapabilitySet,
  type ClientNamespace,
  MemberCount,
  MemberQueries,
  ModuleNav,
  Page,
  useCapabilities,
  useMessages,
  useSession,
} from "~/import.js";

const MESSAGES = ["nav"] as const satisfies readonly ClientNamespace[];

// The count's page: `limit: 1`, because only `total` is read.
const MEMBER_PAGE = { limit: 1, offset: 0 } as const;

// Behind the session guard its layout already applies. A static page in lite: the big kit
// makes each card a widget a person can hide, which comes back from docs/scale/widgets.md.
export const Route = createFileRoute("/(app)/_authenticated/dashboard")({
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    // The same key the `<Can>` around the count asks below, so a member who cannot see it
    // issues no query rather than one the procedure refuses.
    const counted = CapabilitySet.from(context.capabilities).can("member.read")
      ? context.queryClient.ensureQueryData(MemberQueries.list(context.api, MEMBER_PAGE))
      : Promise.resolve(null);
    const [, nav] = await Promise.all([
      context.messages.ensure(MESSAGES),
      context.content.nav(),
      counted,
    ]);
    return { nav };
  },
  component: Dashboard,
});

function Dashboard() {
  const { t } = useMessages("nav");
  const shell = useMessages("common");
  const { nav } = Route.useLoaderData();
  const { user } = useSession();
  const capabilities = useCapabilities();

  // The session already carries every membership with its role, so naming the current one
  // costs no query.
  const active = user?.organizations.find((entry) => entry.id === user.activeOrganizationId);

  return (
    <Page>
      <h1>{t("nav.home.title", { organization: active?.name ?? shell.t("state.empty") })}</h1>
      {active ? <p>{t("nav.home.role", { role: active.roleName })}</p> : null}
      <section>
        <h2>{t("nav.sections")}</h2>
        <ModuleNav
          items={nav}
          capabilities={capabilities}
          className="ui-tiles"
          renderLink={(route, label, icon) => (
            <Link key={route} to={route} className="ui-tile">
              {icon}
              {label}
            </Link>
          )}
        />
      </section>
      <Can permission="member.read" capabilities={capabilities}>
        <section>
          <h2>{t("nav.members")}</h2>
          <MemberCount />
        </section>
      </Can>
    </Page>
  );
}
