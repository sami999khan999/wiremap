import { useSession } from "../auth/index.js";
import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Callout,
  DataTable,
  RoleQueries,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  WIDGET_COPY,
  type WidgetPreferencesDto,
  WidgetQueries,
  WidgetRegistry,
  type WidgetVisibility,
} from "../import.js";
import { capabilitiesFromWire } from "../rbac/index.js";
import { DISMISSAL, useWidgetPreferences } from "./use-widget-preferences.js";
import { widgetFacts } from "./widget-facts.js";

export interface WidgetInspectorProps {
  // Absent: your own view, from the session. Present: that member's, resolved by the server.
  readonly userId?: string;
}

interface InspectorRow {
  readonly id: string;
  readonly visibility: WidgetVisibility;
  // The key that denied it, so "denied" names what is missing rather than that something is.
  readonly permission: string | null;
}

// "Where did my card go?" — every registered widget, plus any stored row naming one that no
// longer exists, with the registry's one-word answer and the reason in words.
export function WidgetInspector({ userId }: WidgetInspectorProps) {
  const { t } = useMessages("widget");
  const describe = useErrorMessage();
  const client = useApiClient();
  const { capabilities: own, flags } = useSession();
  const mine = useWidgetPreferences();
  const on = flags.has(DISMISSAL);

  // The viewer's flag set for either view: same org, and every flag a widget names reaches
  // the session. Another member's capabilities come already masked from the server.
  const effective = useAppQuery({
    ...RoleQueries.effective(client, userId ?? ""),
    enabled: !!userId,
  });
  const theirs = useAppQuery({
    ...WidgetQueries.preferencesOf(client, userId ?? ""),
    enabled: !!userId && on,
  });

  const capabilities = userId
    ? effective.data
      ? capabilitiesFromWire(effective.data.capabilities)
      : null
    : own;
  const preferences: WidgetPreferencesDto | undefined = on
    ? userId
      ? theirs.data
      : mine.preferences
    : undefined;
  const ready = capabilities !== null && (!on || preferences !== undefined);

  const rows = useMemo<readonly InspectorRow[]>(() => {
    if (!ready || !capabilities) return [];
    const registry = WidgetRegistry.instance;
    const facts = widgetFacts(capabilities, flags, preferences ? { preferences } : {});
    const stale = [
      ...(preferences?.hiddenByAdmin ?? []),
      ...(preferences?.hiddenByUser ?? []),
    ].filter((key) => !registry.isKnown(key));
    return [...registry.all(), ...new Set(stale)].map((key) => {
      const visibility = registry.visibilityOf(key, facts);
      const permission = visibility === "denied" ? (registry.meta(key)?.permission ?? null) : null;
      return { id: key, visibility, permission };
    });
  }, [ready, capabilities, flags, preferences]);

  const columns = useMemo<readonly TableColumn<InspectorRow>[]>(
    () => [
      {
        key: "card",
        header: t("widget.inspector.column.card"),
        cell: (row) =>
          WidgetRegistry.instance.isKnown(row.id) ? t(WIDGET_COPY[row.id]) : <code>{row.id}</code>,
      },
      {
        key: "answer",
        header: t("widget.inspector.column.answer"),
        cell: (row) => (
          <>
            <code>{row.visibility}</code>
            {row.permission ? ` — ${row.permission}` : null}{" "}
            <small>
              {row.visibility === "denied"
                ? t("widget.reason.denied", { permission: row.permission ?? "" })
                : t(`widget.reason.${row.visibility}`)}
            </small>
          </>
        ),
      },
    ],
    [t],
  );

  const error = effective.error ?? theirs.error;
  if (error) return <Callout tone="danger">{describe(error)?.message}</Callout>;
  if (!ready) return <DataTable.Skeleton rows={3} columns={2} />;

  return <DataTable columns={columns} rows={rows} caption={t("widget.inspector.title")} />;
}
