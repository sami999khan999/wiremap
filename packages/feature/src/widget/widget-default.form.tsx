import { useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  StatusBadge,
  useApiClient,
  WIDGET_COPY,
  WidgetMutations,
  WidgetRegistry,
  type ZoneKey,
} from "../import.js";
import { DISMISSAL, useWidgetPreferences } from "./use-widget-preferences.js";

export interface WidgetDefaultFormProps {
  readonly zone: ZoneKey;
}

// An admin's hide, for everyone in the org. The page says what it is not: a hidden card's
// data is still reachable by anyone allowed to read it, so this is never how access is cut.
export function WidgetDefaultForm({ zone }: WidgetDefaultFormProps) {
  const { t } = useMessages("widget");
  const describe = useErrorMessage();
  const client = useApiClient();
  const { flags } = useSession();
  const { preferences } = useWidgetPreferences();
  const update = WidgetMutations.useUpdateDefault(client);

  if (!flags.has(DISMISSAL))
    return <Callout tone="info">{t("widget.defaults.unavailable")}</Callout>;

  const registry = WidgetRegistry.instance;
  const hidden = new Set(preferences?.hiddenByAdmin ?? []);

  return (
    <section>
      <p>{t("widget.defaults.description")}</p>
      <ul>
        {registry
          .forZone(zone)
          .filter((key) => registry.isDismissible(key))
          .map((key) => {
            const isHidden = hidden.has(key);
            return (
              <li key={key}>
                {t(WIDGET_COPY[key])}{" "}
                <StatusBadge tone={isHidden ? "warning" : "neutral"}>
                  {isHidden ? t("widget.defaults.hidden") : t("widget.defaults.shown")}
                </StatusBadge>{" "}
                <Button
                  variant="secondary"
                  disabled={update.isPending || preferences === undefined}
                  onClick={() => update.mutate({ widget: key, hidden: !isHidden })}
                >
                  {isHidden ? t("widget.defaults.show") : t("widget.defaults.hide")}
                </Button>
              </li>
            );
          })}
      </ul>
      {update.isError ? <Callout tone="danger">{describe(update.error)?.message}</Callout> : null}
    </section>
  );
}
