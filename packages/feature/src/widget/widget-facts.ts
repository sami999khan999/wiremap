import type { CapabilitySet, FlagKey, WidgetFacts, WidgetPreferencesDto } from "../import.js";

// No row yet: nothing hidden. An inline widget is required, so it never reads them at all.
const NONE: ReadonlySet<string> = new Set<string>();

export interface WidgetFactOptions {
  readonly goalId?: string;
  // Only while `widget.dismissal` is on for this org: off, a stored row hides nothing.
  readonly preferences?: WidgetPreferencesDto;
}

// The facts a render or a loader has in hand, in the shape `visibilityOf` reads. One place,
// so a zone, its tray and its loader's prefetch cannot answer differently.
export function widgetFacts(
  capabilities: CapabilitySet,
  flags: Iterable<FlagKey>,
  options: WidgetFactOptions = {},
): WidgetFacts {
  const { goalId, preferences } = options;
  return {
    capabilities,
    flags: new Set(flags),
    hiddenByAdmin: preferences ? new Set(preferences.hiddenByAdmin) : NONE,
    hiddenByUser: preferences ? new Set(preferences.hiddenByUser) : NONE,
    ...(goalId === undefined ? {} : { goalId }),
  };
}
