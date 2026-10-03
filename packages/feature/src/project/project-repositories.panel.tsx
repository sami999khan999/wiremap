import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  type ProjectDto,
  ProjectMutations,
  ProjectQueries,
  type RepositoryDto,
  Select,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

function RepositoryRow({
  project,
  repository,
}: {
  readonly project: ProjectDto;
  readonly repository: RepositoryDto;
}) {
  const { t } = useMessages("project");
  const client = useApiClient();
  const update = ProjectMutations.useUpdateRepository(client);
  const remove = ProjectMutations.useRemoveRepository(client);
  const [branches, setBranches] = useState(repository.branches.join(", "));
  const [rootPath, setRootPath] = useState(repository.rootPath ?? "");

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm">{repository.fullName}</span>
        <Button
          variant="ghost"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ projectId: project.id, repositoryId: repository.id })}
        >
          {t("project.repositories.remove")}
        </Button>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const list = branches
            .split(",")
            .map((branch) => branch.trim())
            .filter((branch) => branch !== "");
          update.mutate({
            projectId: project.id,
            repositoryId: repository.id,
            branches: list.length > 0 ? list : [repository.defaultBranch],
            rootPath: rootPath.trim() || null,
          });
        }}
      >
        <div className="min-w-48 flex-1">
          <Field
            label={t("project.repositories.branches")}
            htmlFor={`branches-${repository.id}`}
            hint={t("project.repositories.branches.hint")}
          >
            <Input
              id={`branches-${repository.id}`}
              value={branches}
              onChange={(event) => setBranches(event.target.value)}
            />
          </Field>
        </div>
        <div className="min-w-48 flex-1">
          <Field
            label={t("project.repositories.rootPath")}
            htmlFor={`root-${repository.id}`}
            hint={t("project.repositories.rootPath.hint")}
          >
            <Input
              id={`root-${repository.id}`}
              value={rootPath}
              placeholder="/"
              onChange={(event) => setRootPath(event.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={update.isPending}>
          {t("project.settings.save")}
        </Button>
      </form>
    </li>
  );
}

// The repositories a project reads, and adding one from the organization's installations.
export function ProjectRepositoriesPanel({ project }: { readonly project: ProjectDto }) {
  const { t } = useMessages("project");
  const describe = useErrorMessage();
  const client = useApiClient();
  const available = useAppQuery(ProjectQueries.available(client));
  const add = ProjectMutations.useAddRepository(client);
  const [choice, setChoice] = useState<string | null>(null);

  const tracked = new Set(project.repositories.map((repository) => repository.externalId));
  const addable = (available.data ?? []).filter(
    (repository) => !tracked.has(repository.externalId),
  );
  const refusal = describe(add.error);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {project.repositories.map((repository) => (
          <RepositoryRow key={repository.id} project={project} repository={repository} />
        ))}
      </ul>
      {addable.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const repository = addable.find((each) => each.externalId === choice);
            if (repository) add.mutate({ projectId: project.id, ...repository });
          }}
        >
          <Field label={t("project.repositories.add")} htmlFor="project-add-repository">
            <Select
              id="project-add-repository"
              label={t("project.repositories.add")}
              value={choice}
              onValueChange={setChoice}
              options={addable.map((repository) => ({
                value: repository.externalId,
                label: repository.fullName,
              }))}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!choice || add.isPending}>
            {t("project.repositories.add")}
          </Button>
        </form>
      ) : null}
      {refusal ? <Callout tone="danger">{refusal.message}</Callout> : null}
    </div>
  );
}
