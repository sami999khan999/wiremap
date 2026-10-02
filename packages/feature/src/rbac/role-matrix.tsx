import { useCapabilities, useIsPlatformOrganization } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Callout,
  CapabilitySet,
  EmptyState,
  type PermissionKey,
  PermissionRegistry,
  type PermissionScope,
  type RoleDto,
  RoleMutations,
  RoleQueries,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useCallback,
  useMemo,
} from "../import.js";
import { type MatrixSubject, PermissionMatrix } from "./permission-matrix.js";
import { useRoleFailure } from "./use-role-failure.js";

// Frozen once rather than rebuilt per render: it is a prop, and a fresh array each
// render would invalidate the memo inside the matrix.
const PLATFORM_ONLY: readonly PermissionScope[] = Object.freeze(["platform"]);

export interface RoleMatrixProps {
  // Paged rather than unbounded: `Pagination.query` caps `limit` at 100, so asking for
  // more is a validation error rather than a slow page.
  readonly limit?: number;
}

// Reads through a defined query rather than calling the client: a raw call is a read
// nothing can invalidate, which the ban on importing `api-client` here prevents.
export function RoleMatrix({ limit = 25 }: RoleMatrixProps) {
  const { t } = useMessages("role");
  // `common` for the shared states, `role` for this screen's copy. The namespace is what
  // makes the key type narrow enough for a typo to be a compile error.
  const shell = useMessages("common");
  const failureCopy = useRoleFailure();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const isPlatformOrganization = useIsPlatformOrganization();
  const roles = useAppQuery(RoleQueries.list(client, { limit, offset: 0 }));
  const entitlement = useAppQuery(RoleQueries.entitlement(client));
  const grant = RoleMutations.useGrant(client);
  const revoke = RoleMutations.useRevoke(client);

  // Annotated rather than inferred: `ApiClient`'s procedure types are reconstructed
  // through two packages, and a break anywhere degrades to `any` silently.
  const items: readonly RoleDto[] = roles.data?.items ?? [];

  // Both, not either: one checkbox is two writes depending on its current state, and a
  // box that can be ticked but not unticked is a worse answer than a read-only one.
  const editable =
    capabilities.can("rbac.permission.grant") && capabilities.can("rbac.permission.revoke");

  // The same class and method the server runs inside `Authorizer.assert()`, which is why
  // this screen is not a second model of the rules.
  const subjects = useMemo<readonly MatrixSubject[]>(() => {
    const registry = PermissionRegistry.instance;

    return items.map((role) => {
      // A permission the catalog no longer knows is a stale row, not a grant. The API
      // returns it unfiltered; this is where it stops being trusted.
      const known = role.permissions.filter((key) => registry.isKnown(key));
      // On the axis `can()` reads each from: a platform key on the org axis shows as denied.
      const isPlatform = (key: PermissionKey) => registry.scopeOf(key) === "platform";
      return {
        id: role.id,
        label: role.name,
        // Seeded rows are rewritten on every deploy, so the use-case refuses to edit one.
        editable: editable && !role.isSystem,
        capabilities: CapabilitySet.from({
          // Never a wildcard, even for `owner`: the seed writes every permission as a real
          // grant, so this shows what is stored.
          wildcard: false,
          org: { grants: known.filter((key) => !isPlatform(key)), denies: [] },
          platform: { grants: known.filter(isPlatform), denies: [] },
          goals: {},
        }),
      };
    });
  }, [items, editable]);

  // Every catalog key the plan leaves out. Empty until the ceiling loads, so a slow read
  // leaves the matrix editable rather than blocking every row.
  const blocked = useMemo<ReadonlySet<PermissionKey>>(() => {
    const keys = entitlement.data?.keys;
    if (!keys) return new Set();
    const entitled = new Set(keys);
    return new Set(PermissionRegistry.instance.all().filter((key) => !entitled.has(key)));
  }, [entitlement.data]);

  const toggle = useCallback(
    (roleId: string, permission: PermissionKey) => {
      const role = items.find((candidate) => candidate.id === roleId);
      if (!role) return;

      const input = { roleId: role.id, permission };
      if (role.permissions.includes(permission)) revoke.mutate(input);
      else grant.mutate(input);
    },
    [items, grant, revoke],
  );

  const failure = failureCopy(grant.error ?? revoke.error);

  if (roles.isPending) return <EmptyState title={shell.t("state.loading")} />;
  if (roles.isError) return <EmptyState title={failureCopy(roles.error) ?? ""} />;
  if (subjects.length === 0) return <EmptyState title={t("role.empty")} />;

  return (
    <section>
      <p>{t("role.subtitle")}</p>
      {failure ? <Callout tone="danger">{failure}</Callout> : null}
      {
        // A platform key is held through a role in the tier and nowhere else. The grant
        // use-case refuses it already; this removes the checkbox that would have 403'd.
      }
      <PermissionMatrix
        subjects={subjects}
        onToggle={editable ? toggle : undefined}
        excludeScopes={isPlatformOrganization ? undefined : PLATFORM_ONLY}
        blocked={blocked}
      />
      {items.some((role) => role.key === "owner") ? (
        <StatusBadge tone="neutral">{t("role.hint.owner")}</StatusBadge>
      ) : null}
      {items.some((role) => role.isSystem) ? (
        <StatusBadge tone="neutral">{t("role.hint.system")}</StatusBadge>
      ) : null}
      {editable ? null : <StatusBadge tone="neutral">{t("role.hint.readOnly")}</StatusBadge>}
    </section>
  );
}
