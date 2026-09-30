import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  CORE_MODULE,
  Field,
  Input,
  OverrideMutations,
  type PermissionKey,
  PermissionRegistry,
  useApiClient,
  useState,
} from "../import.js";

export interface PermissionOverrideFormProps {
  readonly userId: string;
}

// The keys an exception can name: not `core`, which everyone holds, and not `platform`,
// which is above the tenant. The use-case applies the same rule.
const OVERRIDABLE: readonly PermissionKey[] = Object.freeze(
  PermissionRegistry.instance.all().filter((key) => {
    const meta = PermissionRegistry.instance.meta(key);
    return meta !== undefined && meta.module !== CORE_MODULE && meta.scope !== "platform";
  }),
);

const DAY_MS = 86_400_000;

// A grant needs a reason and ends within ninety days; a deny needs neither. The date
// picker's own `max` says so before the server has to.
export function PermissionOverrideForm({ userId }: PermissionOverrideFormProps) {
  const { t } = useMessages("role");
  const describe = useErrorMessage();
  const client = useApiClient();
  const grant = OverrideMutations.useGrant(client);
  const deny = OverrideMutations.useDeny(client);

  const [permission, setPermission] = useState<string>(OVERRIDABLE[0] ?? "");
  const [effect, setEffect] = useState<"grant" | "deny">("grant");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");

  const latest = new Date(Date.now() + 90 * DAY_MS).toISOString().slice(0, 10);
  const pending = grant.isPending || deny.isPending;
  const written = (effect === "grant" ? grant.data : deny.data)?.permissions;
  const error = grant.error ?? deny.error;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const done = { onSuccess: () => setReason("") };
        if (effect === "grant") {
          grant.mutate(
            { userId, permission, reason, expiresAt: until === "" ? null : new Date(until) },
            done,
          );
        } else {
          deny.mutate({ userId, permission, reason: reason.trim() === "" ? null : reason }, done);
        }
      }}
    >
      <h3>{t("role.override.form.title")}</h3>
      <Field label={t("role.override.form.permission")} htmlFor="override-permission">
        <select
          id="override-permission"
          className="ui-input"
          value={permission}
          onChange={(event) => setPermission(event.target.value)}
        >
          {OVERRIDABLE.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("role.override.form.effect")} htmlFor="override-effect">
        <select
          id="override-effect"
          className="ui-input"
          value={effect}
          onChange={(event) => setEffect(event.target.value === "deny" ? "deny" : "grant")}
        >
          <option value="grant">{t("role.override.form.grant")}</option>
          <option value="deny">{t("role.override.form.deny")}</option>
        </select>
      </Field>
      <Field label={t("role.override.form.reason")} htmlFor="override-reason">
        <Input
          id="override-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {effect === "grant" ? (
        <Field label={t("role.override.form.expires")} htmlFor="override-until">
          <Input
            id="override-until"
            type="date"
            max={latest}
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </Field>
      ) : null}
      <Button type="submit" disabled={pending || (effect === "grant" && reason.trim() === "")}>
        {t("role.override.form.submit")}
      </Button>
      {written ? <p>{t("role.override.written", { permissions: written.join(", ") })}</p> : null}
      {error ? <Callout tone="danger">{describe(error)?.message}</Callout> : null}
    </form>
  );
}
