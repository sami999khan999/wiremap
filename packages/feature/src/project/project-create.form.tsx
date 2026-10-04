import { useCapabilities } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type AvailableRepositoryDto,
  Button,
  buttonClassName,
  Callout,
  DataTable,
  Field,
  GithubQueries,
  Input,
  PROJECT_ROLES,
  ProjectMutations,
  ProjectQueries,
  type ProjectRole,
  ROUTES,
  Select,
  Textarea,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

export interface ProjectCreateFormProps {
  // Where the App's install callback sent the person back from, read off the URL.
  readonly githubResult?: "connected" | "failed";
  readonly onCreated: (slug: string) => void;
}

// A name typed once becomes the URL name until the person edits that field themselves.
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export function ProjectCreateForm({ githubResult, onCreated }: ProjectCreateFormProps) {
  const { t } = useMessages("project");
  const describe = useErrorMessage();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const github = useAppQuery(GithubQueries.status(client));
  const connected = (github.data?.installations.length ?? 0) > 0;
  const available = useAppQuery({ ...ProjectQueries.available(client), enabled: connected });
  const create = ProjectMutations.useCreate(client);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"org" | "restricted">("org");
  const [defaultRole, setDefaultRole] = useState<ProjectRole>("project_editor");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const toggle = (repository: AvailableRepositoryDto) => {
    const next = new Set(picked);
    if (next.has(repository.externalId)) next.delete(repository.externalId);
    else next.add(repository.externalId);
    setPicked(next);
  };

  const refusal = describe(create.error);
  const repositories = available.data ?? [];

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          {
            name: name.trim(),
            slug,
            description: description.trim() || null,
            visibility,
            defaultRole,
            repositories: repositories.filter((repository) => picked.has(repository.externalId)),
          },
          { onSuccess: (project) => onCreated(project.slug) },
        );
      }}
    >
      {githubResult === "connected" ? (
        <Callout tone="success">{t("project.github.connected")}</Callout>
      ) : null}
      {githubResult === "failed" ? (
        <Callout tone="danger">{t("project.github.failed")}</Callout>
      ) : null}

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{t("project.repositories")}</legend>
        {github.isPending ? null : github.data?.installUrl === null ? (
          <div className="flex flex-col items-start gap-3">
            <Callout tone="info">{t("project.github.unconfigured")}</Callout>
            {capabilities.can("platform.github.manage") ? (
              <a
                className={buttonClassName("primary", "no-underline")}
                href={ROUTES.platform.github}
              >
                {t("project.github.setUp")}
              </a>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {github.data?.installations.map((installation) => (
              <span key={installation.installationId} className="text-sm text-fg-muted">
                {installation.accountLogin}
                {installation.suspended ? ` (${t("project.github.suspended")})` : ""}
              </span>
            ))}
            <a
              className={buttonClassName(connected ? "secondary" : "primary", "no-underline")}
              href={github.data?.installUrl ?? "#"}
            >
              {connected ? t("project.github.connectMore") : t("project.github.connect")}
            </a>
          </div>
        )}
        {connected ? (
          available.isPending ? (
            <DataTable.Skeleton rows={3} columns={2} />
          ) : repositories.length === 0 ? (
            <p className="m-0 text-sm text-fg-muted">{t("project.repositories.none")}</p>
          ) : (
            <ul className="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
              <li className="px-2 py-1 text-xs text-fg-muted">{t("project.repositories.pick")}</li>
              {repositories.map((repository) => (
                <li key={repository.externalId}>
                  <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={picked.has(repository.externalId)}
                      onChange={() => toggle(repository)}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">
                      {repository.fullName}
                    </span>
                    {repository.private ? (
                      <span className="text-xs text-fg-muted">
                        {t("project.repositories.private")}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </fieldset>

      <Field label={t("project.name")} htmlFor="project-name">
        <Input
          id="project-name"
          value={name}
          required
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(slugOf(event.target.value));
          }}
        />
      </Field>
      <Field label={t("project.slug")} htmlFor="project-slug" hint={t("project.slug.hint")}>
        <Input
          id="project-slug"
          value={slug}
          required
          minLength={2}
          maxLength={48}
          pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
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

      {refusal ? (
        <Callout tone="danger">
          {refusal.envelope.code === "CONFLICT" ? t("project.slugTaken") : refusal.message}
        </Callout>
      ) : null}
      <div>
        <Button type="submit" disabled={create.isPending || name.trim() === "" || slug.length < 2}>
          {t("project.create")}
        </Button>
      </div>
    </form>
  );
}
