import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AppShell,
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
  type ReactNode,
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

// The sidebar's groups: the product's own sections, then the organization's administration,
// then the tier above it. A module hidden here still answers FORBIDDEN to a typed path.
const WORKSPACE_MODULES = ["project", "doc"] as const;
const ORGANIZATION_MODULES = [
  "organization",
  "member",
  "team",
  "access",
  "ai",
  "webhook",
  "rbac",
  "apikey",
  "audit",
  "document",
  "notification",
] as const;
const PLATFORM_MODULES = ["platform"] as const;

const LINK =
  "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-fg-muted no-underline transition-colors duration-(--duration-fast) hover:bg-muted hover:text-fg [&_svg]:shrink-0";
const ACTIVE = "bg-muted text-fg [&_svg]:text-primary";

function Group({ label, children }: { readonly label?: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {label ? (
        <p className="m-0 px-3 pt-5 pb-1.5 font-semibold text-[11px] text-fg-muted uppercase tracking-wider">
          {label}
        </p>
      ) : null}
      {children}
    </div>
  );
}

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

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Inside a project the graph needs the whole width: no sidebar, a slim bar instead.
  const inProject = pathname.startsWith("/p/");
  const canReadInbox = capabilities.can("notification.inbox.read");

  const brand = (
    <Link
      to="/"
      className="flex items-center gap-2 font-mono font-semibold text-fg text-sm no-underline"
    >
      <Icon name="graph" size={18} className="text-primary" />
      {t("nav.product")}
    </Link>
  );

  const link = (to: string, label: string, icon: ReactNode, exact = false) => (
    <Link
      key={to}
      to={to}
      className={LINK}
      activeProps={{ className: ACTIVE }}
      activeOptions={{ exact }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );

  const modules = (list: readonly (typeof ORGANIZATION_MODULES)[number][] | readonly string[]) => (
    <ModuleNav
      items={nav}
      capabilities={capabilities}
      modules={list as Parameters<typeof ModuleNav>[0]["modules"]}
      className="flex flex-col gap-0.5"
      renderLink={(route, label, icon) => link(route, label, icon)}
    />
  );

  const userMenu = (placement: "bar" | "sidebar") => (
    <UserMenu
      placement={placement}
      auth={auth}
      onSignedOut={signedOut}
      onAccount={() => void navigate({ to: "/settings/account" })}
      onSecurity={() => void navigate({ to: "/settings/security" })}
    />
  );

  const sidebar = (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-border border-b px-4">
        {brand}
        <Can permission="notification.inbox.read" capabilities={capabilities}>
          <NotificationBell href={ROUTES.notification.inbox} />
        </Can>
      </div>
      <nav aria-label={t("nav.sidebar")} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Group>
          {link(ROUTES.shell.dashboard, t("nav.dashboard"), <Icon name="layers" size={16} />, true)}
          {modules(WORKSPACE_MODULES)}
        </Group>
        <Group label={t("nav.settingsYou")}>
          {link("/settings/account", t("nav.account"), <Icon name="user" size={16} />)}
          {link("/settings/security", t("nav.security"), <Icon name="shield" size={16} />)}
          {canReadInbox
            ? link(
                "/settings/notifications",
                t("nav.notificationSettings"),
                <Icon name="bell" size={16} />,
              )
            : null}
        </Group>
        <Group label={t("nav.settingsOrganization")}>{modules(ORGANIZATION_MODULES)}</Group>
        <Group>{modules(PLATFORM_MODULES)}</Group>
      </nav>
      <div className="flex shrink-0 flex-col gap-1 border-border border-t p-3">
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <ModeSwitcher appearance={appearance} snapshot={appearanceSnapshot} />
          <LocaleSwitcher appearance={appearance} current={appearanceSnapshot.locale} />
        </div>
        <OrganizationMenu
          placement="sidebar"
          organization={organization}
          onSwitched={switched}
          onCreate={() => void navigate({ to: "/organization/new" })}
          onSettings={() => void navigate({ to: "/settings" })}
        />
        {userMenu("sidebar")}
      </div>
    </>
  );

  return (
    <RealtimeProvider
      client={api}
      organizationId={session.user?.activeOrganizationId ?? null}
      transport="poll"
    >
      {
        // First in the tab order and visible only while focused: without it a keyboard
        // reader walks the whole sidebar again on every navigation.
      }
      <a className="ui-skip-link" href="#main">
        {t("nav.skip")}
      </a>
      {inProject ? (
        <div className="flex min-h-dvh flex-col">
          <header className="ui-top-bar sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-border border-b bg-surface px-4">
            <Link
              to="/projects"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-fg-muted text-sm no-underline hover:bg-muted hover:text-fg"
            >
              <Icon name="chevron-right" size={14} className="rotate-180" />
              {t("nav.backToProjects")}
            </Link>
            <span aria-hidden="true" className="h-5 w-px bg-border" />
            {brand}
            <div className="ml-auto flex items-center gap-2">
              <Can permission="notification.inbox.read" capabilities={capabilities}>
                <NotificationBell href={ROUTES.notification.inbox} />
              </Can>
              {userMenu("bar")}
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
            <Outlet />
          </main>
        </div>
      ) : (
        <AppShell
          sidebar={sidebar}
          brand={brand}
          sidebarLabel={t("nav.sidebar")}
          openLabel={t("nav.openMenu")}
          closeLabel={t("nav.closeMenu")}
          resizeLabel={t("nav.resizeSidebar")}
          storageKey="wiremap.sidebar.width"
          navigationKey={pathname}
        >
          {
            // The landmark the skip link targets. `tabIndex={-1}` so the anchor moves focus.
          }
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
            <Outlet />
          </main>
        </AppShell>
      )}
    </RealtimeProvider>
  );
}
