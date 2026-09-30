import { useSession } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  type CapabilitySet,
  EmptyState,
  type FlagKey,
  MemberQueries,
  type NavItem,
  type QueryRuntime,
  type ReactNode,
  useApiClient,
  useMemo,
  WIDGET_COPY,
  WidgetMutations,
  type WidgetPreferencesDto,
  WidgetQueries,
  WidgetRegistry,
  ZONE_COPY,
  Zone,
  type ZoneWidgetKey,
} from "../import.js";
import { MemberCount } from "../member/index.js";
import { ModuleNav, type ModuleNavProps } from "../nav/index.js";
import { DISMISSAL, HiddenWidgetList, useWidgetPreferences, widgetFacts } from "../widget/index.js";

const ZONE = "dashboard.main";

type DashboardWidgetKey = ZoneWidgetKey<typeof ZONE>;

export interface DashboardZoneProps {
  // The nav card's menu and links, resolved by the route. Passed through, so the card
  // stays synchronous and the router stays out of this package.
  readonly nav: readonly NavItem[];
  readonly renderLink: ModuleNavProps["renderLink"];
}

interface DashboardWidget {
  readonly component: (props: DashboardZoneProps) => ReactNode;
  // What the card reads, fetched by the route before it renders. Absent for a card that
  // reads nothing.
  readonly prefetch?: (
    queryClient: QueryRuntime["queryClient"],
    client: QueryRuntime["apiClient"],
  ) => Promise<unknown>;
}

// The count's page: `limit: 1`, because only `total` is read.
const MEMBER_PAGE = { limit: 1, offset: 0 } as const;

function DashboardNav({ nav, renderLink }: DashboardZoneProps) {
  const { capabilities } = useSession();
  return <ModuleNav items={nav} capabilities={capabilities} renderLink={renderLink} />;
}

// Total over the zone: a widget registered to it without an entry here does not compile.
// Not exported, so nothing outside can render a card without asking the registry first.
const DASHBOARD_WIDGETS = {
  "core.module-nav": { component: DashboardNav },
  "member.count": {
    component: () => <MemberCount />,
    prefetch: (queryClient, client) =>
      queryClient.ensureQueryData(MemberQueries.list(client, MEMBER_PAGE)),
  },
  "core.hidden-widgets": { component: () => <HiddenWidgetList zone={ZONE} /> },
} as const satisfies Record<DashboardWidgetKey, DashboardWidget>;

const isDashboardWidget = (key: string): key is DashboardWidgetKey =>
  Object.hasOwn(DASHBOARD_WIDGETS, key);

// Visible ones only, in the registry's order. A hidden card is never mounted, so it never
// issues its query: hiding is not a `display: none`.
function visibleWidgets(
  capabilities: CapabilitySet,
  flags: Iterable<FlagKey>,
  preferences: WidgetPreferencesDto | undefined,
): readonly DashboardWidgetKey[] {
  const facts = widgetFacts(capabilities, flags, preferences ? { preferences } : {});
  return WidgetRegistry.instance
    .forZone(ZONE)
    .filter(isDashboardWidget)
    .filter((key) => WidgetRegistry.instance.visibilityOf(key, facts) === "visible");
}

export function DashboardZone(props: DashboardZoneProps) {
  const { t } = useMessages("widget");
  const client = useApiClient();
  const { capabilities, flags } = useSession();
  const { ready, preferences } = useWidgetPreferences();
  const hide = WidgetMutations.useUpdatePreference(client);
  const keys = useMemo(
    () => visibleWidgets(capabilities, flags, preferences),
    [capabilities, flags, preferences],
  );

  // A Hide action only while the rollout is on for this org, and only on a card a person
  // may hide. The nav and the tray are required.
  const canHide = flags.has(DISMISSAL) && capabilities.can("core.widget.customize");
  if (!ready) return null;

  return (
    <Zone
      label={t(ZONE_COPY[ZONE])}
      items={keys.map((key) => {
        const Card = DASHBOARD_WIDGETS[key].component;
        const title = t(WIDGET_COPY[key]);
        const action =
          canHide && WidgetRegistry.instance.isDismissible(key) ? (
            <Button
              variant="ghost"
              aria-label={t("widget.hideCard", { title })}
              disabled={hide.isPending}
              onClick={() => hide.mutate({ widget: key, hidden: true })}
            >
              {t("widget.hide")}
            </Button>
          ) : undefined;
        return { key, title, content: <Card {...props} />, ...(action ? { action } : {}) };
      })}
      empty={<EmptyState title={t("widget.zone.empty")} />}
    />
  );
}

// The route's half: the same visibility the zone will compute, preferences included, so a
// hidden card's query is never issued ahead of a render that will not mount it.
export async function prefetchDashboard(
  queryClient: QueryRuntime["queryClient"],
  client: QueryRuntime["apiClient"],
  capabilities: CapabilitySet,
  flags: Iterable<FlagKey>,
): Promise<void> {
  const on = new Set(flags);
  const preferences = on.has(DISMISSAL)
    ? await queryClient.ensureQueryData(WidgetQueries.preferences(client))
    : undefined;

  await Promise.all(
    visibleWidgets(capabilities, on, preferences).map((key) => {
      const widget: DashboardWidget = DASHBOARD_WIDGETS[key];
      return widget.prefetch ? widget.prefetch(queryClient, client) : Promise.resolve();
    }),
  );
}
