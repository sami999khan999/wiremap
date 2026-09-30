import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Input,
  PlatformMutations,
  PlatformQueries,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

// The incident switch: a module off is gone for every org, whatever its plan. Mounted on
// the status page behind `platform.module.manage`, because status is where on-call looks.
export function ModuleSwitchPanel() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const switches = useAppQuery(PlatformQueries.moduleSwitches(client));
  const update = PlatformMutations.useUpdateModuleSwitch(client);
  // One reason per module, so typing into one row does not fill another.
  const [reasons, setReasons] = useState<Readonly<Record<string, string>>>({});

  return (
    <section>
      <h2>{t("platform.modules.title")}</h2>
      <p>{t("platform.modules.description")}</p>
      <ul>
        {(switches.data?.items ?? []).map((row) => {
          const reason = reasons[row.module] ?? "";
          return (
            <li key={row.module}>
              <code>{row.module}</code>{" "}
              <StatusBadge tone={row.enabled ? "success" : "danger"}>
                {row.enabled ? t("platform.modules.on") : t("platform.modules.off")}
              </StatusBadge>
              {row.enabled ? (
                <>
                  <Input
                    aria-label={`${t("platform.modules.reason")} — ${row.module}`}
                    value={reason}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [row.module]: event.target.value }))
                    }
                  />
                  <Button
                    variant="secondary"
                    disabled={update.isPending || reason.trim() === ""}
                    onClick={() => update.mutate({ module: row.module, enabled: false, reason })}
                  >
                    {t("platform.modules.disable")}
                  </Button>
                </>
              ) : (
                <>
                  {" "}
                  {row.reason}{" "}
                  <Button
                    variant="secondary"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ module: row.module, enabled: true, reason: "" })}
                  >
                    {t("platform.modules.enable")}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {update.isError ? <Callout tone="danger">{describe(update.error)?.message}</Callout> : null}
    </section>
  );
}
