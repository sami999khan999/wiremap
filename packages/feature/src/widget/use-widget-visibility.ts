import { useSession } from "../auth/index.js";
import { useMemo, type WidgetKey, WidgetRegistry, type WidgetVisibility } from "../import.js";
import { widgetFacts } from "./widget-facts.js";

// The registry's answer for the session in hand: flag, then permission, then preferences.
// The permission comes from the registry, never from the call site.
export function useWidgetVisibility(widget: WidgetKey, goalId?: string): WidgetVisibility {
  const { capabilities, flags } = useSession();

  return useMemo(
    () =>
      WidgetRegistry.instance.visibilityOf(
        widget,
        widgetFacts(capabilities, flags, goalId === undefined ? {} : { goalId }),
      ),
    [widget, goalId, capabilities, flags],
  );
}
