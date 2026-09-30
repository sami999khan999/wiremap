import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  ApiKeyMutations,
  Button,
  Callout,
  CORE_MODULE,
  Field,
  type FormEvent,
  Input,
  type PermissionKey,
  PermissionRegistry,
  useApiClient,
  useMemo,
  useState,
} from "../import.js";
import { useApiKeyFailure } from "./use-api-key-failure.js";

// The plaintext lives in this component's state and nowhere else — not in the query
// cache, not in the list response, not in the audit row.
export function CreateApiKeyForm() {
  const { t } = useMessages("apikey");
  const failureCopy = useApiKeyFailure();
  const client = useApiClient();
  const capabilities = useCapabilities();
  const create = ApiKeyMutations.useCreate(client);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<readonly PermissionKey[]>([]);
  const [issued, setIssued] = useState<string | null>(null);

  // Only what the actor holds, minus the `core` module: the use-case refuses the rest,
  // and a permission every principal holds implicitly is not a scope worth choosing.
  const offered = useMemo(() => {
    const registry = PermissionRegistry.instance;
    return registry
      .all()
      .filter((key) => registry.meta(key)?.module !== CORE_MODULE && capabilities.can(key));
  }, [capabilities]);

  const toggle = (key: PermissionKey): void => {
    setScopes((held) => (held.includes(key) ? held.filter((s) => s !== key) : [...held, key]));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name, scopes, expiresAt: null },
      {
        onSuccess: (data) => {
          setIssued(data.token);
          setName("");
          setScopes([]);
        },
      },
    );
  };

  const failure = failureCopy(create.error);

  // Shown until dismissed rather than for a few seconds: this value cannot be recovered,
  // and a toast that disappears while somebody reaches for the clipboard is a lost key.
  if (issued) {
    return (
      <section>
        <h2>{t("apikey.created.title")}</h2>
        <Callout tone="warning">{t("apikey.created.warning")}</Callout>
        <Input readOnly value={issued} onFocus={(event) => event.target.select()} />
        <Button onClick={() => setIssued(null)}>{t("apikey.created.done")}</Button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2>{t("apikey.create.title")}</h2>

      <Field
        label={t("apikey.create.name")}
        htmlFor="api-key-name"
        hint={t("apikey.create.nameHint")}
      >
        <Input
          id="api-key-name"
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

      <fieldset>
        <legend>{t("apikey.create.scopes")}</legend>
        <p>{t("apikey.create.scopesHint")}</p>
        {offered.map((key) => (
          <label key={key}>
            <input type="checkbox" checked={scopes.includes(key)} onChange={() => toggle(key)} />
            <code>{key}</code>
          </label>
        ))}
      </fieldset>

      {failure ? <Callout tone="danger">{failure}</Callout> : null}

      <Button type="submit" disabled={create.isPending || name === "" || scopes.length === 0}>
        {t("apikey.create.submit")}
      </Button>
    </form>
  );
}
