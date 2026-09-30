import type { InlineWidgetKey, ReactNode } from "../import.js";
import { useWidgetVisibility } from "./use-widget-visibility.js";

export interface WidgetProps {
  // Inline only: a zone widget is placed by its zone, and a literal key here is what
  // `check-architecture` §30 reads to prove every inline widget is placed somewhere.
  readonly widget: InlineWidgetKey;
  readonly goalId?: string;
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}

// Gates a unit by its registry entry. No permission prop: the key names the permission, so
// the two cannot disagree. Children come back bare, like `<Can>`, and neither wraps the other.
export function Widget({ widget, goalId, fallback = null, children }: WidgetProps) {
  return useWidgetVisibility(widget, goalId) === "visible" ? children : fallback;
}
