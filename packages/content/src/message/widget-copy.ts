import type { WidgetKey, ZoneKey } from "../import.js";
import type { NamespaceKeys } from "./namespace.js";

type WidgetMessageKey = NamespaceKeys["widget"];

// Total over the registry, on the `ERROR_COPY` pattern: a widget added to a fragment without
// a title here is a compile error, not a card headed by its own raw key.
export const WIDGET_COPY: Readonly<Record<WidgetKey, WidgetMessageKey>> = {
  "core.module-nav": "widget.core.module-nav.title",
  "core.hidden-widgets": "widget.core.hidden-widgets.title",
  "member.count": "widget.member.count.title",
  "notification.bell": "widget.notification.bell.title",
};

// What a screen reader hears for the region. A zone has no visible heading of its own.
export const ZONE_COPY: Readonly<Record<ZoneKey, WidgetMessageKey>> = {
  "dashboard.main": "widget.zone.dashboard.main",
};
