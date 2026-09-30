import { useSession } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  fieldClassName,
  inputClassName,
  type OrganizationClient,
  OrganizationMutations,
} from "../import.js";

export interface OrganizationSwitcherProps {
  readonly organization: OrganizationClient;
  // Runs once the session points at the new tenant. The call site clears the cache, for
  // the reason sign-out does: every cached row belongs to the tenant just left.
  readonly onSwitched: () => void;
  // Where "New organization" goes. A callback, because `feature` may not import routing.
  readonly onCreate: () => void;
}

// Off the session snapshot, not a query: `fetchSession` already carries every membership,
// so the switcher is right on the first painted byte.
export function OrganizationSwitcher({
  organization,
  onSwitched,
  onCreate,
}: OrganizationSwitcherProps) {
  const { t } = useMessages("nav");
  const { user } = useSession();
  const switchTo = OrganizationMutations.useSwitch(organization, onSwitched);

  if (!user) return null;

  return (
    <span className="ui-organization-switcher">
      <label className={fieldClassName.label} htmlFor="organization-switcher">
        {t("nav.organization")}
      </label>{" "}
      {
        // A native select styled as an input, as the invite form's role picker is.
      }
      <select
        id="organization-switcher"
        className={inputClassName()}
        value={user.activeOrganizationId}
        disabled={switchTo.isPending}
        // `disabled` alone removes it from the tab order and says nothing about why.
        aria-busy={switchTo.isPending}
        onChange={(event) => switchTo.mutate({ organizationId: event.target.value })}
      >
        {user.organizations.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>{" "}
      <Button variant="ghost" onClick={onCreate}>
        {t("nav.organizationNew")}
      </Button>
    </span>
  );
}
