import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  type FormEvent,
  Icon,
  Input,
  type ProjectDto,
  ProjectQueries,
  Select,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useState,
  WEBHOOK_EVENTS,
  type WebhookDto,
  type WebhookEventName,
  WebhookMutations,
  WebhookQueries,
} from "../import.js";

const ALL = "__all";

function WebhookRow({
  webhook,
  projectName,
}: {
  readonly webhook: WebhookDto;
  readonly projectName: string;
}) {
  const { t } = useMessages("webhook");
  const client = useApiClient();
  const test = WebhookMutations.useTest(client);
  const update = WebhookMutations.useUpdate(client);
  const remove = WebhookMutations.useRemove(client);
  const ref = { webhookId: webhook.id };
  const status = (value: number | null) =>
    value === null ? t("webhook.test.noResponse") : String(value);

  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name={webhook.kind === "slack" ? "chat" : "webhook"} size={16} />
        <span className="font-mono text-sm">{webhook.target}</span>
        <StatusBadge tone={webhook.disabledAt ? "danger" : "success"}>
          {webhook.disabledAt ? t("webhook.status.off") : t("webhook.status.active")}
        </StatusBadge>
      </div>
      <p className="m-0 text-xs text-fg-muted">
        {projectName} · {webhook.events.map((name) => t(`webhook.event.${name}`)).join(", ")} ·{" "}
        {webhook.lastDeliveredAt
          ? t("webhook.status.last", { status: status(webhook.lastStatus) })
          : t("webhook.status.never")}
        {webhook.failureCount > 0
          ? ` · ${t("webhook.status.failures", { count: webhook.failureCount })}`
          : ""}
      </p>
      {test.data ? (
        <Callout tone={test.data.ok ? "success" : "warning"}>
          {test.data.ok
            ? t("webhook.test.ok", { status: status(test.data.status) })
            : t("webhook.test.failed", { status: status(test.data.status) })}
        </Callout>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(ref)}>
          {t("webhook.test")}
        </Button>
        {webhook.disabledAt ? (
          <Button variant="secondary" onClick={() => update.mutate({ ...ref, enabled: true })}>
            {t("webhook.enable")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => remove.mutate(ref)}>
          {t("webhook.remove")}
        </Button>
      </div>
    </li>
  );
}

// The organization's webhooks: each with where it sends, what, and how its last delivery
// went, then the form that adds one. A generic one's secret is shown once, until dismissed.
export function WebhookPanel() {
  const { t } = useMessages("webhook");
  const client = useApiClient();
  const list = useAppQuery(WebhookQueries.list(client));
  const projects = useAppQuery(ProjectQueries.list(client, { limit: 100, offset: 0 }));
  const create = WebhookMutations.useCreate(client);
  const webhooks: readonly WebhookDto[] = list.data ?? [];
  const projectList: readonly ProjectDto[] = projects.data?.items ?? [];
  const [kind, setKind] = useState<"generic" | "slack">("generic");
  const [url, setUrl] = useState("");
  const [project, setProject] = useState(ALL);
  const [events, setEvents] = useState<readonly WebhookEventName[]>(["scan.failed"]);
  const [secret, setSecret] = useState<string | null>(null);

  const nameOf = (id: string | null) =>
    id ? (projectList.find((each) => each.id === id)?.name ?? id) : t("webhook.project.all");
  const toggle = (name: WebhookEventName) =>
    setEvents(events.includes(name) ? events.filter((each) => each !== name) : [...events, name]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        kind,
        url: url.trim(),
        events: [...events],
        projectId: project === ALL ? null : (project as ProjectDto["id"]),
      },
      {
        onSuccess: (created) => {
          setUrl("");
          setSecret(created.secret);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {secret ? (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-base font-semibold">{t("webhook.secret.title")}</h2>
          <Callout tone="warning">{t("webhook.secret.body")}</Callout>
          <Input
            readOnly
            value={secret}
            className="font-mono"
            onFocus={(event) => event.target.select()}
          />
          <div>
            <Button onClick={() => setSecret(null)}>{t("webhook.secret.done")}</Button>
          </div>
        </section>
      ) : null}

      {webhooks.length === 0 ? (
        <p className="m-0 text-sm text-fg-muted">{t("webhook.empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              projectName={nameOf(webhook.projectId)}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
        <h2 className="m-0 text-base font-semibold">{t("webhook.add")}</h2>
        <Field label={t("webhook.kind")} htmlFor="webhook-kind">
          <Select
            id="webhook-kind"
            label={t("webhook.kind")}
            value={kind}
            onValueChange={(value) => setKind(value === "slack" ? "slack" : "generic")}
            options={[
              { value: "generic", label: t("webhook.kind.generic") },
              { value: "slack", label: t("webhook.kind.slack") },
            ]}
          />
        </Field>
        <Field
          label={t("webhook.url")}
          htmlFor="webhook-url"
          hint={kind === "slack" ? t("webhook.url.hint.slack") : t("webhook.url.hint.generic")}
        >
          <Input
            id="webhook-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label={t("webhook.project")} htmlFor="webhook-project">
          <Select
            id="webhook-project"
            label={t("webhook.project")}
            value={project}
            onValueChange={setProject}
            options={[
              { value: ALL, label: t("webhook.project.all") },
              ...projectList.map((each) => ({ value: each.id, label: each.name })),
            ]}
          />
        </Field>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-sm font-medium">{t("webhook.events")}</legend>
          {WEBHOOK_EVENTS.map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={events.includes(name)}
                onChange={() => toggle(name)}
              />
              {t(`webhook.event.${name}`)}
            </label>
          ))}
        </fieldset>
        {create.isError ? <Callout tone="danger">{t("webhook.failed")}</Callout> : null}
        <div>
          <Button
            type="submit"
            disabled={create.isPending || events.length === 0 || !url.trim().startsWith("https://")}
          >
            {t("webhook.add")}
          </Button>
        </div>
      </form>
    </div>
  );
}
