import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  buttonClassName,
  Callout,
  Field,
  type GithubAppFormDto,
  Input,
  PlatformMutations,
  PlatformQueries,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useEffect,
  useRef,
  useState,
} from "../import.js";

export interface GithubAppPanelProps {
  // What `/api/github/manifest` sent the person back with, read off the URL.
  readonly result?: "created" | "failed";
}

// The deployment's GitHub App. Creating it posts a manifest to GitHub, which shows the App
// filled in, creates it on one click and sends the person back to `/api/github/manifest`.
export function GithubAppPanel({ result }: GithubAppPanelProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const app = useAppQuery(PlatformQueries.githubApp(client));
  const start = PlatformMutations.useStartGithubApp(client);
  const remove = PlatformMutations.useRemoveGithubApp(client);
  const [organization, setOrganization] = useState("");
  const [anyAccount, setAnyAccount] = useState(false);
  const [form, setForm] = useState<GithubAppFormDto | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // GitHub takes the manifest only as a posted field, so the browser must submit a form.
  useEffect(() => {
    if (form) formRef.current?.submit();
  }, [form]);

  const view = app.data;
  if (!view) return null;

  return (
    <section className="flex max-w-2xl flex-col items-start gap-4">
      <p className="m-0">{t("platform.github.intro")}</p>

      {result === "created" ? (
        <Callout tone="success">{t("platform.github.created")}</Callout>
      ) : null}
      {result === "failed" ? <Callout tone="danger">{t("platform.github.failed")}</Callout> : null}

      {view.source === "none" ? (
        <StatusBadge tone="warning">{t("platform.github.none")}</StatusBadge>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone="success">
            {view.source === "environment"
              ? t("platform.github.environment", { slug: view.slug ?? "" })
              : t("platform.github.stored", {
                  slug: view.slug ?? "",
                  owner: view.ownerLogin ?? "",
                })}
          </StatusBadge>
          {view.htmlUrl ? (
            <a
              className={buttonClassName("secondary", "no-underline")}
              href={view.htmlUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("platform.github.open")}
            </a>
          ) : null}
        </div>
      )}

      <p className="m-0 text-sm text-fg-muted">
        {t("platform.github.address", { url: view.publicUrl })}{" "}
        {view.webhooks ? t("platform.github.webhooks") : t("platform.github.polling")}
      </p>

      {view.source === "none" && !view.canCreate ? (
        <Callout tone="warning">{t("platform.github.noEncryption")}</Callout>
      ) : null}

      {view.canCreate ? (
        <form
          className="flex w-full flex-col items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const owner = organization.trim();
            start.mutate(
              { ...(owner ? { organization: owner } : {}), anyAccount },
              { onSuccess: setForm },
            );
          }}
        >
          <Field
            label={t("platform.github.organization")}
            htmlFor="github-app-organization"
            hint={t("platform.github.organization.hint")}
          >
            <Input
              id="github-app-organization"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={anyAccount}
              onChange={() => setAnyAccount(!anyAccount)}
            />
            <span>
              {t("platform.github.anyAccount")}
              <span className="block text-fg-muted">{t("platform.github.anyAccount.hint")}</span>
            </span>
          </label>
          <Button type="submit" disabled={start.isPending || form !== null}>
            {t("platform.github.create")}
          </Button>
          {start.isError ? <Callout tone="danger">{describe(start.error)?.message}</Callout> : null}
        </form>
      ) : null}

      {view.source === "stored" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-fg-muted">{t("platform.github.remove.detail")}</p>
          <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t("platform.github.remove")}
          </Button>
          {remove.isError ? (
            <Callout tone="danger">{describe(remove.error)?.message}</Callout>
          ) : null}
        </div>
      ) : null}

      {form ? (
        <form ref={formRef} method="post" action={form.action} hidden>
          <input type="hidden" name="manifest" value={form.manifest} />
        </form>
      ) : null}
    </section>
  );
}
