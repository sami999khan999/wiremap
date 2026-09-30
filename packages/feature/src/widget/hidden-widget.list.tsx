import { useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  StatusBadge,
  useApiClient,
  useMemo,
  WIDGET_COPY,
  WidgetMutations,
  WidgetRegistry,
  type ZoneKey,
} from "../import.js";
import { useWidgetPreferences } from "./use-widget-preferences.js";
import { WidgetInspector } from "./widget.inspector.js";
import { widgetFacts } from "./widget-facts.js";

export interface HiddenWidgetListProps {
  readonly zone: ZoneKey;
}

// The tray: every card in the zone this person would see but for a hide. Their own come back
// with a click; the org's are locked, because an admin decided them for everyone.
export function HiddenWidgetList({ zone }: HiddenWidgetListProps) {
  const { t } = useMessages("widget");
  const describe = useErrorMessage();
  const client = useApiClient();
  const { capabilities, flags } = useSession();
  const { preferences } = useWidgetPreferences();
  const restore = WidgetMutations.useUpdatePreference(client);

  const rows = useMemo(() => {
    const registry = WidgetRegistry.instance;
    const facts = widgetFacts(capabilities, flags, preferences ? { preferences } : {});
    return registry
      .forZone(zone)
      .filter((key) => registry.isDismissible(key))
      .map((key) => ({ key, visibility: registry.visibilityOf(key, facts) }))
      .filter((row) => row.visibility === "hidden-by-admin" || row.visibility === "hidden-by-user");
  }, [zone, capabilities, flags, preferences]);

  // Every card, not only the hidden ones: a card missing for want of a permission is not in
  // this list at all, and that is the question the disclosure answers.
  const why = (
    <details>
      <summary>{t("widget.reason.disclosure")}</summary>
      <WidgetInspector />
    </details>
  );

  if (rows.length === 0) {
    return (
      <>
        <p>{t("widget.hidden.none")}</p>
        {why}
      </>
    );
  }

  return (
    <>
      <ul>
        {rows.map(({ key, visibility }) => {
          const title = t(WIDGET_COPY[key]);
          return (
            <li key={key}>
              {title}{" "}
              {visibility === "hidden-by-admin" ? (
                <StatusBadge tone="neutral">{t("widget.hidden.byAdmin")}</StatusBadge>
              ) : (
                <Button
                  variant="secondary"
                  aria-label={t("widget.restoreCard", { title })}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ widget: key, hidden: false })}
                >
                  {t("widget.restore")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {restore.isError ? <Callout tone="danger">{describe(restore.error)?.message}</Callout> : null}
      {why}
    </>
  );
}
