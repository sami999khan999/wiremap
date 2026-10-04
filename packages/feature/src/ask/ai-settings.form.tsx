import { PasswordField } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type AiSettingsDto,
  AskMutations,
  AskQueries,
  Button,
  Callout,
  Field,
  Input,
  Select,
  useApiClient,
  useAppQuery,
  useEffect,
  useState,
} from "../import.js";

// The organization's Ask settings. The key is write-only: the form never holds the stored
// one, only what is typed to replace it.
export function AiSettingsForm() {
  const { t } = useMessages("ask");
  const describe = useErrorMessage();
  const client = useApiClient();
  const settings = useAppQuery(AskQueries.settings(client));
  const update = AskMutations.useUpdate(client);
  const test = AskMutations.useTest(client);
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const current: AiSettingsDto | undefined = settings.data;
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"none" | "gemini">("gemini");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [key, setKey] = useState("");

  useEffect(() => {
    if (!current) return;
    setEnabled(current.enabled);
    setProvider(current.provider === "none" ? "gemini" : current.provider);
    setModel(current.model);
  }, [current]);

  if (!current) return null;
  const refusal = describe(update.error);

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          { enabled, provider, model: model.trim(), ...(key.trim() ? { apiKey: key.trim() } : {}) },
          { onSuccess: () => setKey("") },
        );
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {t("ai.enabled")}
      </label>
      <Field label={t("ai.provider")} htmlFor="ai-provider">
        <Select
          id="ai-provider"
          label={t("ai.provider")}
          value={provider}
          onValueChange={(value) => setProvider(value === "none" ? "none" : "gemini")}
          options={[
            { value: "gemini", label: t("ai.provider.gemini") },
            { value: "none", label: t("ai.provider.none") },
          ]}
        />
      </Field>
      <Field label={t("ai.model")} htmlFor="ai-model">
        <Input
          id="ai-model"
          value={model}
          maxLength={80}
          onChange={(event) => setModel(event.target.value)}
          className="font-mono"
        />
      </Field>
      <Field
        label={t("ai.key")}
        htmlFor="ai-key"
        hint={current.keyHint ? t("ai.key.hint", { hint: current.keyHint }) : t("ai.key.none")}
      >
        <PasswordField
          id="ai-key"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </Field>
      {refusal ? (
        <Callout tone="danger">
          {refusal.envelope.fields?.[0]?.field === "apiKey" ? t("ai.keyRequired") : refusal.message}
        </Callout>
      ) : null}
      {update.isSuccess ? <Callout tone="success">{t("ai.saved")}</Callout> : null}
      {test.data ? (
        <Callout tone={test.data.ok ? "success" : "warning"}>
          {test.data.ok ? t("ai.test.ok") : t("ai.test.failed")}
        </Callout>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={update.isPending}>
          {t("ai.save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!current.keyHint || test.isPending}
          onClick={() => test.mutate({})}
        >
          {t("ai.test")}
        </Button>
        {current.keyHint ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              update.mutate({ enabled: false, provider, model: model.trim(), apiKey: null })
            }
          >
            {t("ai.key.remove")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
