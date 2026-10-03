import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import { type ProjectDto, type TabItem, Tabs } from "../import.js";
import { ProjectAccessPanel } from "./project-access.panel.js";
import { ProjectDeletePanel } from "./project-delete.panel.js";
import { ProjectGeneralForm } from "./project-general.form.js";
import { ProjectRepositoriesPanel } from "./project-repositories.panel.js";

export type ProjectSettingsTab = "general" | "repositories" | "access" | "delete";

export interface ProjectSettingsProps {
  readonly project: ProjectDto;
  readonly tab: ProjectSettingsTab;
  readonly onTab: (tab: ProjectSettingsTab) => void;
  readonly onDeleted: () => void;
}

// One tab per key, each shown only to whoever holds it on this project: a tab that answers
// FORBIDDEN on every action is noise.
export function ProjectSettings({ project, tab, onTab, onDeleted }: ProjectSettingsProps) {
  const { t } = useMessages("project");
  const capabilities = useCapabilities();
  const can = (key: "project.settings.manage" | "project.access.manage" | "project.delete") =>
    capabilities.can(key, project.id);

  const items: TabItem[] = [];
  if (can("project.settings.manage")) {
    items.push({ value: "general", label: t("project.settings.general") });
    items.push({ value: "repositories", label: t("project.repositories") });
  }
  if (can("project.access.manage"))
    items.push({ value: "access", label: t("project.settings.access") });
  if (can("project.delete")) items.push({ value: "delete", label: t("project.settings.danger") });

  const current = items.some((item) => item.value === tab) ? tab : (items[0]?.value ?? "general");

  return (
    <Tabs
      label={t("project.settings")}
      value={current}
      onValueChange={(value) => onTab(value as ProjectSettingsTab)}
      items={items}
    >
      {(value) => {
        if (value === "general") return <ProjectGeneralForm project={project} />;
        if (value === "repositories") return <ProjectRepositoriesPanel project={project} />;
        if (value === "access") return <ProjectAccessPanel project={project} />;
        if (value === "delete")
          return <ProjectDeletePanel project={project} onDeleted={onDeleted} />;
        return null;
      }}
    </Tabs>
  );
}
