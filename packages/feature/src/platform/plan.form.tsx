import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  CORE_MODULE,
  Field,
  Input,
  type PermissionKey,
  PermissionRegistry,
  type PlanDto,
  PlatformMutations,
  useApiClient,
  useMemo,
  useState,
} from "../import.js";

export interface PlanFormProps {
  // Absent for a new plan. Present, the key is fixed: it is what orgs point at.
  readonly plan?: PlanDto;
  readonly onDone: () => void;
}

// Every key a plan can hold, grouped by module: `core` is everyone's and `platform` is
// above every tenant, so neither is offered. The server applies the same rule.
const MODULES: readonly (readonly [string, readonly PermissionKey[]])[] = Object.freeze(
  PermissionRegistry.instance
    .modules()
    .filter((module) => module !== CORE_MODULE)
    .map((module) => {
      const keys = PermissionRegistry.instance
        .byModule(module)
        .filter((key) => PermissionRegistry.instance.scopeOf(key) !== "platform");
      return [module, keys] as const;
    })
    .filter(([, keys]) => keys.length > 0),
);

// Ticking a key ticks what it needs; unticking one unticks what depends on it. The saved
// plan is closed over `requires` either way, so the form only shows that happening.
export function PlanForm({ plan, onDone }: PlanFormProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const save = PlatformMutations.useSavePlan(client);
  const registry = PermissionRegistry.instance;

  const [key, setKey] = useState(plan?.key ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [chosen, setChosen] = useState<ReadonlySet<PermissionKey>>(
    () => new Set((plan?.permissions ?? []).filter((entry) => registry.isKnown(entry))),
  );

  const add = (keys: readonly PermissionKey[]) =>
    setChosen((current) => new Set([...current, ...registry.closure(keys)]));
  const remove = (keys: readonly PermissionKey[]) => {
    const gone = new Set(registry.dependentClosure(keys));
    setChosen((current) => new Set([...current].filter((entry) => !gone.has(entry))));
  };

  const sorted = useMemo(() => [...chosen].sort(), [chosen]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ key, name, description, permissions: sorted }, { onSuccess: onDone });
      }}
    >
      <Field label={t("platform.plan.key")} htmlFor="plan-key">
        <Input
          id="plan-key"
          value={key}
          disabled={plan !== undefined}
          onChange={(event) => setKey(event.target.value)}
        />
      </Field>
      <Field label={t("platform.plan.name")} htmlFor="plan-name">
        <Input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t("platform.plan.description")} htmlFor="plan-description">
        <Input
          id="plan-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <p>{t("platform.plan.closure")}</p>
      {MODULES.map(([module, keys]) => {
        const all = keys.every((entry) => chosen.has(entry));
        return (
          <fieldset key={module}>
            <legend>
              <label>
                <input
                  type="checkbox"
                  checked={all}
                  onChange={() => (all ? remove(keys) : add(keys))}
                />{" "}
                {t("platform.plan.module", { module })}
              </label>
            </legend>
            {keys.map((entry) => (
              <label key={entry}>
                <input
                  type="checkbox"
                  checked={chosen.has(entry)}
                  onChange={() => (chosen.has(entry) ? remove([entry]) : add([entry]))}
                />{" "}
                <code>{entry}</code>
              </label>
            ))}
          </fieldset>
        );
      })}

      <Button type="submit" disabled={save.isPending || key.trim() === "" || name.trim() === ""}>
        {t("platform.plan.save")}
      </Button>
      <Button type="button" variant="secondary" onClick={onDone}>
        {t("platform.plan.cancel")}
      </Button>
      {save.isError ? <Callout tone="danger">{describe(save.error)?.message}</Callout> : null}
    </form>
  );
}
