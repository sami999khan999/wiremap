import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export class WidgetContract {
  private constructor() {}

  // Strings, not keys: a stored row can outlive the widget it names, and the client reads
  // an unknown one as `unregistered` rather than failing to parse the response.
  public static readonly preferences = z.object({
    hiddenByAdmin: z.array(z.string()).readonly(),
    hiddenByUser: z.array(z.string()).readonly(),
  });

  public static readonly preferencesOf = z.object({ userId: Identifiers.userId });

  // `hidden: false` is a restore. One procedure for both, because both are one row.
  public static readonly preferenceUpdate = z.object({
    widget: z.string().trim().min(1).max(120),
    hidden: z.boolean(),
  });
}

export type WidgetPreferencesDto = z.infer<typeof WidgetContract.preferences>;
export type WidgetPreferenceUpdateInput = z.infer<typeof WidgetContract.preferenceUpdate>;
