import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  type ProjectDto,
  ProjectMutations,
  useApiClient,
  useState,
} from "../import.js";

// Typed confirmation, as the organization delete: the name, not a checkbox a stray click sets.
export function ProjectDeletePanel({
  project,
  onDeleted,
}: {
  readonly project: ProjectDto;
  readonly onDeleted: () => void;
}) {
  const { t } = useMessages("project");
  const describe = useErrorMessage();
  const client = useApiClient();
  const remove = ProjectMutations.useRemove(client);
  const [typed, setTyped] = useState("");
  const refusal = describe(remove.error);

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        remove.mutate({ projectId: project.id }, { onSuccess: onDeleted });
      }}
    >
      <p className="m-0 text-sm text-fg-muted">{t("project.delete.description")}</p>
      <Field
        label={t("project.delete.confirm", { name: project.name })}
        htmlFor="project-delete-confirm"
      >
        <Input
          id="project-delete-confirm"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
      {refusal ? <Callout tone="danger">{refusal.message}</Callout> : null}
      <div>
        <Button
          type="submit"
          variant="danger"
          disabled={typed !== project.name || remove.isPending}
        >
          {t("project.delete")}
        </Button>
      </div>
    </form>
  );
}
