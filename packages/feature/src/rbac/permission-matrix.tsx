import { useMessages } from "../i18n/index.js";
import {
  type CapabilitySet,
  dataTableClassName,
  type PermissionKey,
  PermissionRegistry,
  type PermissionScope,
} from "../import.js";

export interface MatrixSubject {
  readonly id: string;
  readonly label: string;
  readonly capabilities: CapabilitySet;
  // Per subject, not per matrix: a page showing four roles where one is seeded needs
  // three editable columns and one that is not.
  readonly editable?: boolean;
}

export interface PermissionMatrixProps {
  // A prop rather than a fetch, deliberately: the rows are the bundled catalog and the
  // columns are whatever the caller is comparing.
  readonly subjects: readonly MatrixSubject[];
  readonly goalId?: string;
  readonly onToggle?: (subjectId: string, permission: PermissionKey) => void;
  // By scope, never by module name: "not a tenant's to hold" is a property of the
  // scope, and a module list here would go stale the first time one is renamed.
  readonly excludeScopes?: readonly PermissionScope[];
  // Keys the org's plan does not include. Shown, not hidden — the grant is still stored,
  // and an upgrade brings it back — but the row cannot be edited.
  readonly blocked?: ReadonlySet<PermissionKey>;
}

// Rows are every permission in the catalog, grouped by module; columns are subjects.
// Doc 23 names this component and specifies no body.
export function PermissionMatrix({
  subjects,
  goalId,
  onToggle,
  excludeScopes,
  blocked,
}: PermissionMatrixProps) {
  const { t } = useMessages("common");
  // The column of permission names has no visible heading, and an empty `<th>` is
  // announced as blank. `role` is loaded by the only screen that renders this.
  const { t: rbac } = useMessages("role");
  const registry = PermissionRegistry.instance;
  // The grant use-case already refuses a key the granter does not hold, so this removes
  // the checkbox that would have produced the 403 rather than the enforcement.
  const permissions = excludeScopes?.length
    ? registry.all().filter((key) => {
        const scope = registry.scopeOf(key);
        return scope === undefined || !excludeScopes.includes(scope);
      })
    : registry.all();

  if (subjects.length === 0 || permissions.length === 0) return <p>{t("state.empty")}</p>;

  return (
    <table className={dataTableClassName.table}>
      <thead>
        <tr>
          <th
            scope="col"
            aria-label={rbac("role.column.permission")}
            className={dataTableClassName.header}
          />
          {subjects.map((subject) => (
            <th key={subject.id} scope="col" className={dataTableClassName.header}>
              {subject.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {permissions.map((permission) => {
          const outside = blocked?.has(permission) ?? false;
          return (
            <tr key={permission} data-blocked={outside ? "true" : undefined}>
              {
                // `scope="row"`, or a screen reader reads every cell as a bare "yes"
                // or "no" with no permission attached.
              }
              <th scope="row" className={dataTableClassName.header}>
                <code>{permission}</code>
                {outside ? <small> {rbac("role.blocked")}</small> : null}
              </th>
              {subjects.map((subject) => {
                const allowed = subject.capabilities.can(permission, goalId);
                return (
                  <td
                    key={subject.id}
                    data-allowed={allowed ? "true" : "false"}
                    className={dataTableClassName.cell}
                  >
                    {onToggle && subject.editable ? (
                      <input
                        type="checkbox"
                        checked={allowed}
                        disabled={outside}
                        aria-label={`${subject.label} — ${permission}`}
                        onChange={() => onToggle(subject.id, permission)}
                      />
                    ) : // A word, not a glyph. The row and column headers already say which
                    // permission and subject a cell is about, so the cell carries only the
                    // answer. A design pass can swap in an icon behind `data-allowed`.
                    allowed ? (
                      t("state.allowed")
                    ) : (
                      t("state.denied")
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
