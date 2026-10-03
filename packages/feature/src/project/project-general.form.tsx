import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  PROJECT_ROLES,
  type ProjectDto,
  ProjectMutations,
  type ProjectRole,
  Select,
  Textarea,
  useApiClient,
  useState,
} from "../import.js";

type Schedule = ProjectDto["schedule"];
const SCHEDULES: readonly Schedule[] = ["off", "daily", "weekly"];

// Name, visibility and how a scan reads the code: everything `project.update` takes.
export function ProjectGeneralForm({ project }: { readonly project: ProjectDto }) {
  const { t } = useMessages("project");
  const describe = useErrorMessage();
  const client = useApiClient();
  const update = ProjectMutations.useUpdate(client);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [visibility, setVisibility] = useState(project.visibility);
  const [defaultRole, setDefaultRole] = useState<ProjectRole>(project.defaultRole);
  const [schedule, setSchedule] = useState<Schedule>(project.schedule);
  const [ignore, setIgnore] = useState(project.ignore.join("\n"));
  const [tsconfigPath, setTsconfigPath] = useState(project.settings.tsconfigPath ?? "");
  const [workspace, setWorkspace] = useState(project.settings.workspace ?? "");

  const refusal = describe(update.error);

  return (
    <form
      className="flex max-w-2xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          projectId: project.id,
          name: name.trim(),
          description: description.trim() || null,
          visibility,
          defaultRole,
          schedule,
          ignore: ignore
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
          settings: {
            tsconfigPath: tsconfigPath.trim() || null,
            workspace: workspace.trim() || null,
          },
        });
      }}
    >
      <Field label={t("project.name")} htmlFor="project-name">
        <Input
          id="project-name"
          value={name}
          required
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label={t("project.description")} htmlFor="project-description">
        <Textarea
          id="project-description"
          rows={2}
          maxLength={280}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field label={t("project.visibility")} htmlFor="project-visibility">
        <Select
          id="project-visibility"
          label={t("project.visibility")}
          value={visibility}
          onValueChange={(value) => setVisibility(value === "restricted" ? "restricted" : "org")}
          options={[
            { value: "org", label: t("project.visibility.org") },
            { value: "restricted", label: t("project.visibility.restricted") },
          ]}
        />
      </Field>
      {visibility === "org" ? (
        <Field label={t("project.defaultRole")} htmlFor="project-default-role">
          <Select
            id="project-default-role"
            label={t("project.defaultRole")}
            value={defaultRole}
            onValueChange={(value) =>
              setDefaultRole(PROJECT_ROLES.find((role) => role === value) ?? "project_viewer")
            }
            options={PROJECT_ROLES.map((role) => ({
              value: role,
              label: t(`project.role.${role}`),
            }))}
          />
        </Field>
      ) : null}

      <h2 className="m-0 mt-2 text-base font-semibold">{t("project.settings.analysis")}</h2>
      <Field label={t("project.schedule")} htmlFor="project-schedule">
        <Select
          id="project-schedule"
          label={t("project.schedule")}
          value={schedule}
          onValueChange={(value) => setSchedule(SCHEDULES.find((each) => each === value) ?? "off")}
          options={SCHEDULES.map((each) => ({ value: each, label: t(`project.schedule.${each}`) }))}
        />
      </Field>
      <Field label={t("project.ignore")} htmlFor="project-ignore" hint={t("project.ignore.hint")}>
        <Textarea
          id="project-ignore"
          rows={6}
          className="font-mono"
          value={ignore}
          onChange={(event) => setIgnore(event.target.value)}
        />
      </Field>
      <Field label={t("project.tsconfigPath")} htmlFor="project-tsconfig">
        <Input
          id="project-tsconfig"
          value={tsconfigPath}
          maxLength={200}
          placeholder="tsconfig.json"
          onChange={(event) => setTsconfigPath(event.target.value)}
        />
      </Field>
      <Field label={t("project.workspace")} htmlFor="project-workspace">
        <Input
          id="project-workspace"
          value={workspace}
          maxLength={200}
          placeholder="apps/web"
          onChange={(event) => setWorkspace(event.target.value)}
        />
      </Field>

      {refusal ? <Callout tone="danger">{refusal.message}</Callout> : null}
      {update.isSuccess ? <Callout tone="success">{t("project.settings.saved")}</Callout> : null}
      <div>
        <Button type="submit" disabled={update.isPending || name.trim() === ""}>
          {t("project.settings.save")}
        </Button>
      </div>
    </form>
  );
}
