import { useCapabilities, useIsPlatformOrganization, useSession } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  type PermissionKey,
  PLATFORM_ROUTE_PERMISSION,
  type ReactNode,
  ROUTES,
} from "../import.js";

export interface PlatformNavProps {
  // The router's link. A callback, because `feature` may not import routing.
  readonly renderLink: (href: string, label: string) => ReactNode;
  // Switches the session into the platform organization. Shown only while another is active.
  readonly onOpenPlatform: (organizationId: string) => void;
  readonly opening?: boolean;
}

type Label =
  | "platform.nav.status"
  | "platform.nav.accounts"
  | "platform.nav.entitlements"
  | "platform.nav.flags"
  | "platform.nav.team"
  | "platform.nav.roles"
  | "platform.nav.docs";

interface Item {
  readonly href: string;
  readonly permission: PermissionKey;
  readonly label: Label;
}

// The platform pages, each behind the key its own guard asks for.
const PAGES: readonly Item[] = Object.freeze([
  {
    href: ROUTES.platform.status,
    permission: PLATFORM_ROUTE_PERMISSION.status,
    label: "platform.nav.status",
  },
  {
    href: ROUTES.platform.accounts,
    permission: PLATFORM_ROUTE_PERMISSION.accounts,
    label: "platform.nav.accounts",
  },
  {
    href: ROUTES.platform.entitlements,
    permission: PLATFORM_ROUTE_PERMISSION.entitlements,
    label: "platform.nav.entitlements",
  },
  {
    href: ROUTES.platform.flags,
    permission: PLATFORM_ROUTE_PERMISSION.flags,
    label: "platform.nav.flags",
  },
]);

// The platform organization run like any other: its team, its roles, its docs. These pages act
// on the active organization, so they are offered only while that is the platform's.
const ORGANIZATION: readonly Item[] = Object.freeze([
  { href: ROUTES.rbac.members, permission: "member.read", label: "platform.nav.team" },
  { href: ROUTES.rbac.roles, permission: "rbac.role.read", label: "platform.nav.roles" },
  { href: ROUTES.doc.manage, permission: "doc.page.write", label: "platform.nav.docs" },
]);

export function PlatformNav({ renderLink, onOpenPlatform, opening = false }: PlatformNavProps) {
  const { t } = useMessages("platform");
  const capabilities = useCapabilities();
  const inPlatform = useIsPlatformOrganization();
  const { user } = useSession();
  const platform = user?.organizations.find((organization) => organization.isPlatform);

  const visible = (items: readonly Item[]) =>
    items.filter((item) => capabilities.can(item.permission));

  return (
    <nav
      aria-label={t("platform.nav.label")}
      className="ui-platform-nav flex flex-wrap items-center gap-3"
    >
      {visible(PAGES).map((item) => (
        <span key={item.href}>{renderLink(item.href, t(item.label))}</span>
      ))}
      {inPlatform
        ? visible(ORGANIZATION).map((item) => (
            <span key={item.href}>{renderLink(item.href, t(item.label))}</span>
          ))
        : null}
      {!inPlatform && platform ? (
        <Button variant="secondary" disabled={opening} onClick={() => onOpenPlatform(platform.id)}>
          {t("platform.nav.open")}
        </Button>
      ) : null}
    </nav>
  );
}
