import { createFileRoute, Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  Can,
  CapabilitySet,
  type ClientNamespace,
  Icon,
  ModuleNav,
  NotificationBell,
  NotificationQueries,
  OrganizationClient,
  OrganizationMenu,
  RealtimeProvider,
  ROUTES,
  UserMenu,
  useApiClient,
  useCapabilities,
  useMemo,
  useMessages,
} from "~/import.js";
import { ModeSwitcher } from "~/route/-appearance.js";
import { Pending } from "~/route/-boundary.js";
import { RouteGuard } from "~/route/-guard.js";
import { LocaleSwitcher } from "~/route/-locale.js";
import { refreshSession } from "~/route/-session.js";

// The product's own sections sit in the top bar. The administrative ones are in the
// settings sidebar (`settings.tsx`), which renders every other module.
const TOP_BAR_MODULES = ["doc", "platform"] as const;

// `nav` for the top bar, and `notification` for the bell's name and its peek list.
const MESSAGES = ["nav", "notification"] as const satisfies readonly ClientNamespace[];

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

    const [, nav] = await Promise.all([
      context.messages.ensure(MESSAGES),
      context.content.nav(),
      counted,
    ]);

    return { nav };
  },
  component: AuthenticatedLayout,
  // Covers every page below, so a leaf whose loader prefetches — `/settings/roles`
  // does — has a state to show rather than a blank frame.
  pendingComponent: Pending,
});

function AuthenticatedLayout() {
  const { t } = useMessages("nav");
  const { nav } = Route.useLoaderData();
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
    <RealtimeProvider
      client={api}
      organizationId={session.user?.activeOrganizationId ?? null}
      transport="poll"
    >
      {
        // First in the tab order and visible only while focused: without it a keyboard
        // reader walks the whole header again on every navigation.
      }
      <a className="ui-skip-link" href="#main">
        {t("nav.skip")}
      </a>
      <header className="ui-top-bar sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border bg-bg px-3 sm:gap-3 sm:px-4">
        <Link
          to="/"
          className="flex items-center gap-2 font-mono text-sm font-semibold text-fg no-underline"
        >
          <Icon name="graph" size={18} className="text-primary" />
          <span className="hidden sm:inline">{t("nav.product")}</span>
        </Link>
        <span aria-hidden="true" className="hidden text-fg-muted sm:inline">
          /
        </span>
        <OrganizationMenu
          organization={organization}
          onSwitched={switched}
          onCreate={() => void navigate({ to: "/organization/new" })}
          onSettings={() => void navigate({ to: "/settings" })}
        />
        {
          // The gated half, from `ContentSource.nav()` joined to `MODULE_GATES`. A link
          // hidden here still answers FORBIDDEN if the path is typed by hand.
        }
        <ModuleNav
          items={nav}
          capabilities={capabilities}
          modules={TOP_BAR_MODULES}
          className="hidden items-center gap-1 md:flex"
          renderLink={(route, label) => (
            <Link
              key={route}
              to={route}
              className="rounded-sm px-2 py-1 text-sm text-fg-muted no-underline hover:bg-muted hover:text-fg"
              activeProps={{ className: "text-fg" }}
            >
              {label}
            </Link>
          )}
        />
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {
            // An affordance, so `<Can>`: the inbox route and its procedures are the gate.
            <Can permission="notification.inbox.read" capabilities={capabilities}>
              <NotificationBell href={ROUTES.notification.inbox} />
            </Can>
          }
          <span className="hidden sm:inline-flex">
            <ModeSwitcher appearance={appearance} snapshot={appearanceSnapshot} />
          </span>
          <LocaleSwitcher appearance={appearance} current={appearanceSnapshot.locale} />
          <UserMenu
            auth={auth}
            onSignedOut={signedOut}
            onAccount={() => void navigate({ to: "/settings/account" })}
            onSecurity={() => void navigate({ to: "/settings/security" })}
          />
        </div>
      </header>
      {
        // The landmark the skip link targets, and the one a screen reader jumps to.
        // `tabIndex={-1}` so the anchor moves focus rather than only scrolling.
      }
      <main id="main" tabIndex={-1} className="min-h-[calc(100dvh-3rem)] outline-none">
        <Outlet />
      </main>
    </RealtimeProvider>
  );
}
