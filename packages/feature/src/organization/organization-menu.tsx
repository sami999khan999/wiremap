import { useSession } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  ActionMenu,
  type ActionMenuEntry,
  Avatar,
  Icon,
  type OrganizationClient,
  OrganizationMutations,
} from "../import.js";

export interface OrganizationMenuProps {
  readonly organization: OrganizationClient;
  // Runs once the session points at the new tenant; the call site clears the cache.
  readonly onSwitched: () => void;
  // Callbacks, because `feature` may not import routing.
  readonly onCreate: () => void;
  readonly onSettings: () => void;
}

// The top bar's tenant control: the active organization's tile, name and a chevron, opening
// on every organization the person belongs to. Off the session snapshot, so no query.
export function OrganizationMenu({
  organization,
  onSwitched,
  onCreate,
  onSettings,
}: OrganizationMenuProps) {
  const { t } = useMessages("nav");
  const { user } = useSession();
  const switchTo = OrganizationMutations.useSwitch(organization, onSwitched);

  if (!user) return null;
  const active = user.organizations.find((candidate) => candidate.id === user.activeOrganizationId);

  const entries: ActionMenuEntry[] = [
    ...user.organizations.map(
      (candidate): ActionMenuEntry => ({
        kind: "item",
        key: candidate.id,
        label: candidate.name,
        detail: candidate.roleName,
        checked: candidate.id === user.activeOrganizationId,
        disabled: switchTo.isPending,
        onSelect: () => {
          if (candidate.id !== user.activeOrganizationId) {
            switchTo.mutate({ organizationId: candidate.id });
          }
        },
      }),
    ),
    { kind: "separator", key: "separator" },
    {
      kind: "item",
      key: "settings",
      label: t("nav.organizationSettings"),
      icon: "settings",
      onSelect: onSettings,
    },
    { kind: "item", key: "new", label: t("nav.organizationNew"), icon: "plus", onSelect: onCreate },
  ];

  return (
    <ActionMenu
      label={t("nav.organizationMenu")}
      entries={entries}
      header={<span className="text-xs text-fg-muted">{t("nav.organizations")}</span>}
      trigger={
        <>
          <Avatar name={active?.name ?? "?"} size="sm" className="rounded-sm" />
          <span className="max-w-40 truncate text-sm font-medium">{active?.name}</span>
          <Icon name="chevron-up-down" size={14} className="text-fg-muted" />
        </>
      }
    />
  );
}
