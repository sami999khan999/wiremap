import { createFileRoute, Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  Can,
  CapabilitySet,
  type ClientNamespace,
  ModuleNav,
  NotificationBell,
  NotificationQueries,
  OrganizationClient,
  OrganizationSwitcher,
  RealtimeProvider,
  ROUTES,
  SignOutButton,
  useApiClient,
  useCapabilities,
  useMemo,
  useMessages,
} from "~/import.js";
import { Pending } from "~/route/-boundary.js";
import { RouteGuard } from "~/route/-guard.js";
import { LocaleSwitcher } from "~/route/-locale.js";
import { refreshSession } from "~/route/-session.js";

// `nav` for the gated destinations below; `auth` for everything else the header says.
const MESSAGES = ["nav"] as const satisfies readonly ClientNamespace[];

// The one place that says every page under `(app)` needs a session. Pathless: the
// leading underscore keeps `_authenticated` out of the URL.
export const Route = createFileRoute("/(app)/_authenticated")({
  beforeLoad: RouteGuard.requireSession(),
  // The header renders `auth` copy on every page in this subtree, so the namespace is
  // ensured here rather than in each leaf.
  staticData: { messages: MESSAGES },
  // The menu is content, so it is loaded like content. Both in parallel: neither
  // depends on the other and the header needs both before it renders.
  loader: async ({ context }) => {
    // The same key the `<Can>` around the bell asks below, so a member who cannot see it
    // issues no count query rather than one the procedure refuses.
    const counted = CapabilitySet.from(context.capabilities).can("notification.inbox.read")
      ? context.queryClient.ensureQueryData(NotificationQueries.unreadCount(context.api))
      : Promise.resolve(null);

    // The logo goes through `ContentSource.media()` rather than importing the file:
    // content records hold `"brand.logo"`, never a path, so a CDN is one adapter.
    const [, nav, logo] = await Promise.all([
      context.messages.ensure(MESSAGES),
      context.content.nav(),
      context.content.media("brand.logo"),
      counted,
    ]);

    return { nav, logo };
  },
  component: AuthenticatedLayout,
  // Covers every page below, so a leaf whose loader prefetches — `/settings/roles`
  // does — has a state to show rather than a blank frame.
  pendingComponent: Pending,
});

function AuthenticatedLayout() {
  const { t } = useMessages("nav");
  const { nav, logo } = Route.useLoaderData();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const router = useRouter();
  const { session, queryClient, appearance, appearanceSnapshot } = Route.useRouteContext();

  // Here rather than in `__root`, because a stream opened before there is a session is
  // a request that 401s and then retries forever.
  const api = useApiClient();
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  const organization = useMemo(() => new OrganizationClient(auth), [auth]);

  const refresh = (to: "/" | "/sign-in") => () =>
    refreshSession({
      queryClient,
      session,
      invalidateRouter: () => router.invalidate(),
      go: () => void navigate({ to }),
    });

  // After a switch every cached row belongs to the tenant just left, and the snapshot
  // names the old one — the same reason a sign-out clears.
  const signedOut = refresh("/sign-in");
  const switched = refresh("/");

  return (
    <RealtimeProvider client={api} organizationId={session.user?.activeOrganizationId ?? null}>
      {
        // First in the tab order and visible only while focused: without it a keyboard
        // reader walks the whole header again on every navigation.
      }
      <a className="ui-skip-link" href="#main">
        {t("nav.skip")}
      </a>
      <header>
        <img src={logo.src} width={logo.width} height={logo.height} alt={logo.alt} />
        <OrganizationSwitcher
          organization={organization}
          onSwitched={switched}
          onCreate={() => void navigate({ to: "/organization/new" })}
        />
        {
          // An affordance, so `<Can>`: the inbox route and its procedures are the gate.
          <Can permission="notification.inbox.read" capabilities={capabilities}>
            <NotificationBell href={ROUTES.notification.inbox} />
          </Can>
        }
        {
          // Ungated on purpose: your own account and security pages need no capability,
          // which is why `account.routes.ts` declares no gate for them.
          <nav aria-label={t("nav.account")}>
            <Link to="/settings/account">{t("nav.account")}</Link>
            <Link to="/settings/security">{t("nav.security")}</Link>
          </nav>
        }
        {
          // The gated half, from `ContentSource.nav()` joined to `MODULE_GATES`. A link
          // hidden here still answers FORBIDDEN if the path is typed by hand.
        }
        <ModuleNav
          items={nav}
          capabilities={capabilities}
          renderLink={(route, label, icon) => (
            <Link key={route} to={route}>
              {icon}
              {label}
            </Link>
          )}
        />
        <LocaleSwitcher appearance={appearance} current={appearanceSnapshot.locale} />
        <SignOutButton auth={auth} onSignedOut={signedOut} />
      </header>
      {
        // The landmark the skip link targets, and the one a screen reader jumps to.
        // `tabIndex={-1}` so the anchor moves focus rather than only scrolling.
      }
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </RealtimeProvider>
  );
}
