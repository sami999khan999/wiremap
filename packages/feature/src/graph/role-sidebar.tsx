import { useMessages } from "../i18n/index.js";
import { type GraphDocument, RoleDot, Select } from "../import.js";
import type { ExplorerState, ExplorerView } from "./explorer-model.js";
import { PLAIN_BUTTON, RoleTones } from "./role-tone.js";

const FRAMEWORK_NAMES: Readonly<Record<string, string>> = {
  nextjs: "Next.js",
  "tanstack-start": "TanStack Start",
  nestjs: "NestJS",
  laravel: "Laravel",
  react: "React",
};

export interface RoleSidebarProps {
  readonly document: GraphDocument;
  readonly view: ExplorerView;
  readonly state: ExplorerState;
  readonly onState: (change: Partial<ExplorerState>) => void;
}

// Roles with their dots and counts; one click highlights a role, a second clears it. The
// folder, repository and depth filters sit below, in the same column.
export function RoleSidebar({ document, view, state, onState }: RoleSidebarProps) {
  const { t } = useMessages("graph");
  const backend =
    document.frameworks.find((framework) => framework.id !== "react") ?? document.frameworks[0];
  const top = [...new Set(document.files.map((file) => file.path.split("/")[0] ?? ""))]
    .filter(Boolean)
    .sort();
  const repositories = document.meta.repositories.map((repository) => repository.name);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <section>
        <h2 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {backend
            ? t("graph.roles", { framework: FRAMEWORK_NAMES[backend.id] ?? backend.id })
            : t("graph.roles.any")}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {view.roles.map(({ role, count }) => (
            <li key={role}>
              <button
                type="button"
                aria-pressed={state.role === role}
                onClick={() => onState({ role: state.role === role ? null : role })}
                className={`${PLAIN_BUTTON} flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted aria-pressed:bg-muted aria-pressed:text-fg ${state.role && state.role !== role ? "text-fg-muted" : "text-fg"}`}
              >
                <RoleDot tone={RoleTones.of(role)} />
                <span className="flex-1">{role}</span>
                <span className="text-xs text-fg-muted">{count}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-xs text-fg-muted">{t("graph.roles.hint")}</p>
      </section>
      <Select
        label={t("graph.filter.folder")}
        value={state.folder ?? ""}
        onValueChange={(value) =>
          onState({ folder: value === "" ? null : value, expanded: new Set() })
        }
        options={[
          { value: "", label: t("graph.filter.all") },
          ...top.map((folder) => ({ value: folder, label: folder })),
        ]}
      />
      {repositories.length > 1 ? (
        <Select
          label={t("graph.filter.repository")}
          value={state.repository ?? ""}
          onValueChange={(value) => onState({ repository: value === "" ? null : value })}
          options={[
            { value: "", label: t("graph.filter.all") },
            ...repositories.map((name) => ({ value: name, label: name })),
          ]}
        />
      ) : null}
      <Select
        label={t("graph.depth")}
        value={String(state.depth)}
        onValueChange={(value) => onState({ depth: Number(value), expanded: new Set() })}
        options={[1, 2, 3, 4].map((depth) => ({
          value: String(depth),
          label: `${t("graph.depth")}: ${depth}`,
        }))}
      />
    </div>
  );
}
