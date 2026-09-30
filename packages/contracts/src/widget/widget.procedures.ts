import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { WidgetContract } from "./widget.contract.js";

export class WidgetProcedures {
  private constructor() {}

  public static readonly preferences = oc
    .route({ method: "GET", path: "/widgets/preferences" })
    .output(WidgetContract.preferences);

  // Another member's, for the inspector. Its own path, so reading someone else's is a
  // permission the route names rather than an optional field on your own.
  public static readonly preferencesOf = oc
    .route({ method: "GET", path: "/widgets/preferences/{userId}" })
    .input(WidgetContract.preferencesOf)
    .output(WidgetContract.preferences);

  public static readonly updatePreference = oc
    .route({ method: "PUT", path: "/widgets/preferences" })
    .input(WidgetContract.preferenceUpdate)
    .output(Envelope.acknowledged);

  public static readonly updateDefault = oc
    .route({ method: "PUT", path: "/widgets/defaults" })
    .input(WidgetContract.preferenceUpdate)
    .output(Envelope.acknowledged);

  // The object the merge point in `procedure/index.ts` mounts.
  public static readonly all = {
    preferences: WidgetProcedures.preferences,
    preferencesOf: WidgetProcedures.preferencesOf,
    updatePreference: WidgetProcedures.updatePreference,
    updateDefault: WidgetProcedures.updateDefault,
  } as const;
}
