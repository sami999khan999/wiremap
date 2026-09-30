import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  CORE_MODULE,
  type ExplanationDto,
  type PermissionKey,
  PermissionRegistry,
  RoleQueries,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useMemo,
} from "../import.js";
import { capabilitiesFromWire } from "./capabilities-from-wire.js";

type Source = "role" | "override" | "denied" | "platform" | "plan";

// Where one key's answer comes from, broadest cause first: the platform's deny, then the
// org's, then the plan's ceiling, then an exception, then the role. Org scope only.
function sourceOf(explanation: ExplanationDto, key: PermissionKey): Source | null {
  const rows = explanation.overrides.filter((row) => row.permission === key && row.goalId === null);
  if (rows.some((row) => row.effect === "deny" && row.authority === "platform")) {
    return "platform";
  }
  if (rows.some((row) => row.effect === "deny")) return "denied";
  const granted =
    rows.some((row) => row.effect === "grant") || explanation.roleGrants.includes(key);
  if (!granted) return null;
  if (!explanation.entitled.includes(key)) return "plan";
  return rows.some((row) => row.effect === "grant") ? "override" : "role";
}

export interface EffectivePermissionsInspectorProps {
  // Without one, `can()` denies every goal-scoped key — correct, and worth showing
  // rather than hiding.
  readonly goalId?: string;
  // Absent means the viewer's own, answered from the session with no round trip.
  // Present means someone else's, which only the server can resolve.
  readonly userId?: string;
}

// "What can this principal actually do, right now", against the same `CapabilitySet`
// the server calls `can()` on — one implementation, so the answer cannot differ.
export function EffectivePermissionsInspector({
  goalId,
  userId,
}: EffectivePermissionsInspectorProps) {
  const own = useCapabilities();
  const { t } = useMessages("common");
  // Only read when there is an explanation, which only a route that loads `role` asks for.
  const { t: role } = useMessages("role");
  const describe = useErrorMessage();
  const client = useApiClient();

  // `enabled` on the query rather than a conditional hook: the viewer's own set needs
  // no request, and hooks cannot be called on a branch.
  const other = useAppQuery({ ...RoleQueries.effective(client, userId ?? ""), enabled: !!userId });

  const capabilities = useMemo(
    () => (userId ? (other.data ? capabilitiesFromWire(other.data.capabilities) : null) : own),
    [userId, other.data, own],
  );

  const registry = PermissionRegistry.instance;
  const modules = registry.modules();

  if (userId && other.isPending) return <p>{t("state.loading")}</p>;
  if (userId && other.isError) return <p>{describe(other.error)?.message}</p>;
  if (!capabilities || modules.length === 0) return <p>{t("state.empty")}</p>;

  return (
    <div className="ui-stack flex flex-col gap-3">
      {modules.map((module) => (
        <section key={module}>
          <h3>{module}</h3>
          <ul>
            {registry.byModule(module).map((permission) => {
              const allowed = capabilities.can(permission, goalId);
              return (
                <li key={permission}>
                  <code>{permission}</code>{" "}
                  <StatusBadge tone={allowed ? "success" : "neutral"}>
                    {allowed ? t("state.allowed") : t("state.denied")}
                  </StatusBadge>{" "}
                  {
                    // Beside the answer on purpose: a goal-scoped key reading "denied"
                    // with no goal selected is not a permission problem.
                  }
                  <small>{registry.scopeOf(permission)}</small>
                  {(() => {
                    const explanation = userId ? other.data?.explanation : undefined;
                    if (!explanation || registry.meta(permission)?.module === CORE_MODULE) {
                      return null;
                    }
                    const source = sourceOf(explanation, permission);
                    return source ? <small> · {role(`role.source.${source}`)}</small> : null;
                  })()}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
