import {
  ConflictError,
  type DismissibleWidgetKey,
  ValidationError,
  WidgetRegistry,
} from "../import.js";
import type { WidgetPreferences } from "./widget-preference.repository.js";

export class WidgetRules {
  private constructor() {}

  // Known, and dismissible. A required card — the nav, the hidden tray — is never hidden:
  // the nav is the last path to every capability.
  public static assertDismissible(value: string): DismissibleWidgetKey {
    const registry = WidgetRegistry.instance;
    if (!registry.isKnown(value)) {
      throw new ValidationError([{ field: "widget", rule: "unknown" }]);
    }
    if (!registry.isDismissible(value)) {
      throw new ValidationError([{ field: "widget", rule: "required" }]);
    }
    return value;
  }

  // The admin's hide is for everyone, and a person bringing it back for themselves would
  // make "hidden for everyone" mean "hidden until someone clicks".
  public static assertRestorable(preferences: WidgetPreferences, widget: string): void {
    if (preferences.hiddenByAdmin.includes(widget)) {
      throw new ConflictError("widget", "hidden-by-admin");
    }
  }
}
