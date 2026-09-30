import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import { Button, Can } from "../import.js";
import {
  EffectivePermissionsInspector,
  PermissionOverrideForm,
  PermissionOverrideList,
} from "../rbac/index.js";

export interface MemberAccessPanelProps {
  readonly userId: string;
  readonly onClose: () => void;
}

// One member's access in one place: their exceptions, a form to add one, and the resolved
// answer with each key's source. Each part stands behind the key its data needs.
export function MemberAccessPanel({ userId, onClose }: MemberAccessPanelProps) {
  const { t } = useMessages("member");
  const { t: role } = useMessages("role");
  const capabilities = useCapabilities();

  return (
    <section>
      <h2>{t("member.access.title")}</h2>
      <Can permission="rbac.override.read" capabilities={capabilities}>
        <h3>{role("role.override.title")}</h3>
        <PermissionOverrideList userId={userId} />
      </Can>
      <Can permission="rbac.override.manage" capabilities={capabilities}>
        <PermissionOverrideForm userId={userId} />
      </Can>
      <Can permission="rbac.effective.inspect" capabilities={capabilities}>
        <EffectivePermissionsInspector userId={userId} />
      </Can>
      <Button variant="secondary" onClick={onClose}>
        {t("member.access.close")}
      </Button>
    </section>
  );
}
