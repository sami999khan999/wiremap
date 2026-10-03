import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { CapabilitySet, ModuleNav, useCapabilities, useMessages } from "~/import.js";

// Every module but the two the top bar holds: these are the administrative ones.
const SETTINGS_MODULES = [
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

const linkClass =
  "block rounded-sm px-2 py-1.5 text-sm text-fg-muted no-underline hover:bg-muted hover:text-fg";
const activeClass = "bg-muted text-fg";

// Settings pages share one left column: the person's own pages, then the organization's.
// Below `md` the column becomes a row that scrolls sideways, so a phone keeps its width.
export const Route = createFileRoute("/(app)/_authenticated/settings")({
  loader: ({ context }) => context.content.nav(),
  component: SettingsLayout,
});

function SettingsLayout() {
  const { t } = useMessages("nav");
  const nav = Route.useLoaderData();
  const capabilities = useCapabilities();
  const { capabilities: wire } = Route.useRouteContext();
  const canReadInbox = CapabilitySet.from(wire).can("notification.inbox.read");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
      <aside aria-label={t("nav.settings")} className="shrink-0 md:w-56">
        <nav aria-label={t("nav.settingsYou")} className="flex gap-1 overflow-x-auto md:flex-col">
          <p className="hidden px-2 pb-1 text-xs text-fg-muted md:block">{t("nav.settingsYou")}</p>
          <Link
            to="/settings/account"
            className={linkClass}
            activeProps={{ className: activeClass }}
          >
            {t("nav.account")}
          </Link>
          <Link
            to="/settings/security"
            className={linkClass}
            activeProps={{ className: activeClass }}
          >
            {t("nav.security")}
          </Link>
          {canReadInbox ? (
            <Link
              to="/settings/notifications"
              className={linkClass}
              activeProps={{ className: activeClass }}
            >
              {t("nav.notificationSettings")}
            </Link>
          ) : null}
        </nav>
        <p className="hidden px-2 pb-1 pt-4 text-xs text-fg-muted md:block">
          {t("nav.settingsOrganization")}
        </p>
        <ModuleNav
          items={nav}
          capabilities={capabilities}
          modules={SETTINGS_MODULES}
          className="mt-1 flex gap-1 overflow-x-auto md:flex-col"
          renderLink={(route, label) => (
            <Link
              key={route}
              to={route}
              className={linkClass}
              activeProps={{ className: activeClass }}
            >
              {label}
            </Link>
          )}
        />
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
